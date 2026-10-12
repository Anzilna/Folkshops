from contextlib import AbstractAsyncContextManager
from enum import Enum
from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, Field, SecretStr

from app.domain.models.retrieval import Citation


class ActorContext(BaseModel):
    """
    Trusted, authenticated context a tool executes under — built exclusively
    from the verified JWT in api/dependencies.py. NEVER constructed from
    anything the LLM or the request body supplies; see ADR 0011/0015.
    """

    tenant_id: str
    actor_id: str
    actor_type: Literal["staff", "customer"]
    # Staff only ("owner" | "staff"); None for customers.
    role: str | None = None
    # The caller's own access token, forwarded to core-api's MCP endpoints
    # so every tool runs with exactly the user's permissions — never a
    # service-wide credential. SecretStr + exclude keep it out of logs,
    # reprs and any model_dump().
    access_token: SecretStr | None = Field(default=None, exclude=True, repr=False)


class ToolStatus(str, Enum):
    SUCCEEDED = "succeeded"
    # Definitely NOT applied (rejected by core-api before writing, or the
    # request never reached it).
    FAILED = "failed"
    # MAY have been applied — a mutation whose response was lost. Never
    # reported to the user as success or as failure.
    UNKNOWN = "unknown"
    # Refused by ai-service itself (validation, policy, budget, unknown tool).
    REJECTED = "rejected"
    # Stopped at the confirmation gate; a human must confirm it.
    REQUIRES_CONFIRMATION = "requires_confirmation"


class ToolOutcome(BaseModel):
    """
    The only shape a tool result takes once it leaves a provider — what the
    model sees, what the audit log records, and what the response's
    activity/action cards are built from. Status is set by our code, never
    inferred from what the model says happened.
    """

    tool_name: str
    status: ToolStatus
    data: dict | None = None
    error_code: str | None = None
    message: str | None = None
    pending_action_id: UUID | None = None
    truncated: bool = False
    # Server-side only (knowledge_search) — never sent to the model.
    citations: list[Citation] = Field(default=[], exclude=True)

    def for_model(self) -> dict:
        body: dict = {"status": self.status.value}
        if self.data is not None:
            body["data"] = self.data
        if self.error_code:
            body["error_code"] = self.error_code
        if self.message:
            body["message"] = self.message
        if self.truncated:
            body["truncated"] = True
        return body


class ToolSession(Protocol):
    """One provider's tools, opened for one actor for the length of one agent run (or one confirmed action)."""

    def available(self) -> dict[str, dict]:
        """Tool name -> the input JSON Schema the provider actually serves. Empty if the provider is unreachable."""
        ...

    async def call(self, name: str, arguments: dict, timeout_s: float) -> ToolOutcome:
        """Never raises for a tool or transport failure — those come back as a FAILED outcome with an error_code."""
        ...


class ToolProvider(Protocol):
    """
    Implemented by an adapter (in-process local tools, or the MCP client) —
    application/agent code depends only on this Protocol, never on MCP or
    any specific transport directly.
    """

    def session(self, actor: ActorContext) -> AbstractAsyncContextManager[ToolSession]: ...


# Error codes a ToolSession may return (FAILED). Transport-level ones may be
# retried; the rest are definite answers from the server.
TRANSPORT_ERROR_CODES = frozenset({"timeout", "transport", "unavailable"})
