"""
Test doubles for the agent: a scripted LLM and an in-memory tool provider.
Deterministic, no network — the agent-loop tests never depend on a real
model's behaviour, only on what the loop does with a given model output.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from app.domain.errors import LLMProviderError
from app.domain.interfaces.llm import LLMRequest, LLMResponse, StopReason, ToolCall
from app.domain.interfaces.tool_provider import ActorContext, ToolOutcome, ToolStatus
from app.domain.tools.catalog import CATALOG


def call(name: str, call_id: str = "c1", **arguments) -> ToolCall:
    return ToolCall(id=call_id, name=name, arguments=arguments)


def tool_turn(*calls: ToolCall) -> LLMResponse:
    return LLMResponse(
        content="", tool_calls=list(calls), prompt_tokens=100, completion_tokens=10, stop_reason=StopReason.TOOL_CALLS
    )


def answer(text: str) -> LLMResponse:
    return LLMResponse(content=text, prompt_tokens=100, completion_tokens=20)


class ScriptedLLM:
    """Returns the scripted responses in order; records every request it got. An Exception in the script is raised."""

    def __init__(self, *script):
        self.script = list(script)
        self.requests: list[LLMRequest] = []

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        if not self.script:
            raise AssertionError("ScriptedLLM ran out of responses")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def stream(self, request):  # pragma: no cover
        raise NotImplementedError


class RepeatingLLM(ScriptedLLM):
    """Always returns the same response — for loop/budget tests."""

    def __init__(self, response: LLMResponse):
        super().__init__()
        self._response = response

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        return self._response


class FakeSession:
    def __init__(self, provider: "FakeToolProvider", actor: ActorContext):
        self._provider = provider
        self.actor = actor

    def available(self) -> dict[str, dict]:
        return self._provider.served

    async def call(self, name: str, arguments: dict, timeout_s: float) -> ToolOutcome:
        self._provider.calls.append((name, arguments, self.actor.tenant_id))
        handler = self._provider.handlers.get(name)
        if handler is None:
            return ToolOutcome(tool_name=name, status=ToolStatus.SUCCEEDED, data={"ok": True})
        result = handler(arguments)
        if isinstance(result, ToolOutcome):
            return result.model_copy(update={"tool_name": name})
        return ToolOutcome(tool_name=name, status=ToolStatus.SUCCEEDED, data=result)


class FakeToolProvider:
    """
    Serves every catalog tool of `kind` with our own schema (so the registry
    sees a matching server), records calls, and answers from `handlers`
    (name -> fn(args) -> dict | ToolOutcome).
    """

    def __init__(self, kind: str = "mcp", handlers: dict | None = None, served: dict | None = None):
        self.handlers = handlers or {}
        self.calls: list[tuple[str, dict, str]] = []
        if served is None:
            served = {}
            for specs in CATALOG.values():
                for spec in specs:
                    if spec.provider == kind:
                        served[spec.name] = spec.llm_schema()
        self.served = served

    @asynccontextmanager
    async def session(self, actor: ActorContext) -> AsyncIterator[FakeSession]:
        yield FakeSession(self, actor)


def failing(code: str) -> ToolOutcome:
    return ToolOutcome(tool_name="x", status=ToolStatus.FAILED, error_code=code, message=code)


RATE_LIMITED = LLMProviderError("rate limited", retryable=True)
