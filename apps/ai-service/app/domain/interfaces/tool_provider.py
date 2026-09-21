from typing import Protocol

from pydantic import BaseModel

from app.domain.models.chat import Role  # noqa: F401  (re-exported for tool implementations)


class ActorContext(BaseModel):
    """
    Trusted, authenticated context a tool executes under — built exclusively
    from the verified JWT in api/dependencies.py. NEVER constructed from
    anything the LLM or the request body supplies; see section 16 (Tool
    security) and ADR 0011.
    """

    tenant_id: str
    actor_id: str
    actor_type: str  # "staff" | "customer"


class ToolInvocation(BaseModel):
    tool_name: str
    arguments: dict
    actor: ActorContext


class ToolResult(BaseModel):
    tool_name: str
    output: dict
    error: str | None = None


class ToolProvider(Protocol):
    """
    Implemented by an adapter (internal HTTP call to core-api, or an MCP
    client) — application/agent code depends only on this Protocol and on
    ToolRegistry, never on MCP or any specific transport directly.
    """

    async def invoke(self, invocation: ToolInvocation) -> ToolResult: ...
