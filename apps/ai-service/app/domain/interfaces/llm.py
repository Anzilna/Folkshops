from collections.abc import AsyncIterator
from enum import Enum
from typing import Protocol

from pydantic import BaseModel

from app.domain.models.chat import Role


class ToolCall(BaseModel):
    """A tool call the model PROPOSED. Nothing executes it until the agent's
    executor has validated the arguments and the policy engine has allowed it."""

    id: str
    name: str
    arguments: dict


class LLMMessage(BaseModel):
    role: Role
    content: str = ""
    # role=assistant: the calls the model made in this turn.
    tool_calls: list[ToolCall] = []
    # role=tool: which call this is the result of (some vendors match on id,
    # Gemini on name, so both are carried).
    tool_call_id: str | None = None
    tool_name: str | None = None
    # Opaque, adapter-owned state a vendor needs echoed back verbatim on the
    # next request (Gemini's thought signatures). Only the adapter that
    # produced it ever reads it; the agent just carries it along.
    provider_state: dict | None = None


class ToolDefinition(BaseModel):
    """Vendor-neutral tool schema — an LLMProvider adapter translates this into whatever shape its own API wants."""

    name: str
    description: str
    parameters: dict


class LLMRequest(BaseModel):
    model: str
    messages: list[LLMMessage]
    system_prompt: str | None = None
    temperature: float = 0.2
    max_tokens: int = 1024
    tools: list[ToolDefinition] = []


class StopReason(str, Enum):
    STOP = "stop"
    TOOL_CALLS = "tool_calls"
    MAX_TOKENS = "max_tokens"
    # The vendor's own safety filter blocked the prompt or the answer.
    SAFETY = "safety"
    OTHER = "other"


class LLMResponse(BaseModel):
    content: str
    tool_calls: list[ToolCall] = []
    prompt_tokens: int = 0
    # Includes any "thinking" tokens — vendors bill those as output.
    completion_tokens: int = 0
    cached_tokens: int = 0
    model: str | None = None
    stop_reason: StopReason = StopReason.STOP
    provider_state: dict | None = None


class LLMStreamEvent(BaseModel):
    """Phase 2 (streaming, section 18) — the event shape is fixed now so a provider swap never changes it later."""

    type: str  # token | tool_started | tool_completed | citation | completed | error
    data: dict = {}


class LLMProvider(Protocol):
    async def generate(self, request: LLMRequest) -> LLMResponse: ...

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        """Phase 2. A Phase 1 provider may raise NotImplementedError; the /chat/stream route isn't wired yet."""
        ...
