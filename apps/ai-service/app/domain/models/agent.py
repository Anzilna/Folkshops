from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field

from app.domain.models.chat import MAX_CHAT_MESSAGE_CHARS
from app.domain.models.retrieval import Citation


class AgentChatRequest(BaseModel):
    conversation_id: UUID | None = None
    message: str = Field(min_length=1, max_length=MAX_CHAT_MESSAGE_CHARS)
    # Set by the client once per message it sends. A resend with the same id
    # (double-click, network retry) returns the first run's response instead
    # of starting a second run.
    client_message_id: UUID | None = None


class RunStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    BUDGET_EXHAUSTED = "budget_exhausted"
    LOOP_DETECTED = "loop_detected"
    FAILED = "failed"


class ActionStatus(str, Enum):
    PENDING = "pending"
    EXECUTING = "executing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    UNKNOWN = "unknown"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ActionField(BaseModel):
    label: str
    before: str | None = None
    after: str


class ActionCard(BaseModel):
    """
    A proposed change, rendered by OUR code from the validated arguments and
    a fresh read of the current values — never from the model's prose. This
    is what the human actually confirms, and its status is the authoritative
    record of what happened.
    """

    id: UUID
    tool: str
    title: str
    fields: list[ActionField]
    status: ActionStatus
    expires_at: datetime
    message: str | None = None


class ToolActivity(BaseModel):
    """One tool call in a run, as the UI shows it ("Searched products ✓")."""

    tool: str
    status: str


class AgentChatResponse(BaseModel):
    conversation_id: UUID
    run_id: UUID
    answer: str
    status: RunStatus
    citations: list[Citation] = []
    actions: list[ActionCard] = []
    activity: list[ToolActivity] = []


class ActionResultResponse(BaseModel):
    action: ActionCard
    message: str
