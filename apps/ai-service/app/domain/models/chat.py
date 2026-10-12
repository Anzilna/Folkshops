from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field

from app.domain.models.retrieval import Citation


class Role(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class Message(BaseModel):
    id: UUID
    conversation_id: UUID
    tenant_id: UUID
    role: Role
    content: str
    created_at: datetime


class Conversation(BaseModel):
    id: UUID
    tenant_id: UUID
    actor_id: str
    created_at: datetime
    updated_at: datetime


MAX_CHAT_MESSAGE_CHARS = 4000


class ChatRequest(BaseModel):
    conversation_id: UUID | None = None
    # Bounded so one request can't push an arbitrarily large prompt (and
    # bill) at the LLM. Over the limit is a 422 from FastAPI's validation.
    message: str = Field(min_length=1, max_length=MAX_CHAT_MESSAGE_CHARS)


class ChatResponse(BaseModel):
    conversation_id: UUID
    answer: str
    citations: list[Citation] = []
