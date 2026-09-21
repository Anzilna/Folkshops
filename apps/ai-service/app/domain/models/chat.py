from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel

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


class ChatRequest(BaseModel):
    conversation_id: UUID | None = None
    message: str


class ChatResponse(BaseModel):
    conversation_id: UUID
    answer: str
    citations: list[Citation] = []
