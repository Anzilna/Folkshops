from collections.abc import AsyncIterator
from typing import Protocol

from pydantic import BaseModel

from app.domain.models.chat import Role


class LLMMessage(BaseModel):
    role: Role
    content: str


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


class ToolCall(BaseModel):
    name: str
    arguments: dict


class LLMResponse(BaseModel):
    content: str
    tool_calls: list[ToolCall] = []
    prompt_tokens: int = 0
    completion_tokens: int = 0


class LLMStreamEvent(BaseModel):
    """Phase 2 (streaming, section 18) — the event shape is fixed now so a provider swap never changes it later."""

    type: str  # token | tool_started | tool_completed | citation | completed | error
    data: dict = {}


class LLMProvider(Protocol):
    async def generate(self, request: LLMRequest) -> LLMResponse: ...

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        """Phase 2. A Phase 1 provider may raise NotImplementedError; the /chat/stream route isn't wired yet."""
        ...
