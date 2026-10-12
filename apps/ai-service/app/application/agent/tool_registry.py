"""
Which tools a run can see, and the open provider sessions to call them on.

A tool is offered to the model only if it is (a) in the catalog for the
actor's profile (our allowlist) AND (b) actually served by its provider for
this actor right now AND (c) the server's argument schema still matches
ours. Anything else is hidden for this run and logged — a core-api deploy
that adds or changes a tool can't silently widen what the model can do.
"""

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass

from app.domain.interfaces.llm import ToolDefinition
from app.domain.interfaces.tool_provider import ActorContext, ToolProvider, ToolSession
from app.domain.tools.spec import Profile, ToolSpec, schema_compatible
from app.observability.logging import get_logger

logger = get_logger(__name__)


@dataclass
class RunTools:
    specs: dict[str, ToolSpec]
    sessions: dict[str, ToolSession]
    hidden: dict[str, str]

    def definitions(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(name=s.name, description=s.description, parameters=s.llm_schema())
            for s in self.specs.values()
        ]

    def spec(self, name: str) -> ToolSpec | None:
        return self.specs.get(name)

    def session_for(self, spec: ToolSpec) -> ToolSession:
        return self.sessions[spec.provider]


class ToolRegistry:
    def __init__(self, catalog: dict[str, tuple[ToolSpec, ...]], providers: dict[str, ToolProvider]):
        self._catalog = catalog
        self._providers = providers

    def spec(self, profile: Profile, name: str) -> ToolSpec | None:
        return next((s for s in self._catalog[profile] if s.name == name), None)

    @asynccontextmanager
    async def open(self, profile: Profile, actor: ActorContext) -> AsyncIterator[RunTools]:
        specs = self._catalog[profile]
        async with AsyncExitStack() as stack:
            sessions: dict[str, ToolSession] = {}
            for kind in {s.provider for s in specs}:
                provider = self._providers.get(kind)
                if provider is not None:
                    sessions[kind] = await stack.enter_async_context(provider.session(actor))

            visible: dict[str, ToolSpec] = {}
            hidden: dict[str, str] = {}
            for spec in specs:
                session = sessions.get(spec.provider)
                served = session.available() if session else {}
                if spec.name not in served:
                    hidden[spec.name] = "not_served"
                elif not schema_compatible(spec.llm_schema(), served[spec.name]):
                    hidden[spec.name] = "schema_mismatch"
                    logger.warning("tool_schema_mismatch", tool=spec.name, profile=profile)
                else:
                    visible[spec.name] = spec
            if hidden:
                logger.info("tools_hidden", profile=profile, hidden=hidden)
            yield RunTools(specs=visible, sessions=sessions, hidden=hidden)
