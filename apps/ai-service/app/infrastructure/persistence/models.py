"""
SQLAlchemy ORM mappings for the AI service's own tables.

migrations/*.sql stays the source of truth for the schema — RLS policies,
GRANTs and the ivfflat index can't be expressed here at all, so these
classes only describe the columns queries need. A column added in a new
migration must be added here by hand too (same class of gap as CLAUDE.md
bug #8's DTO whitelist: nothing errors, the field is just invisible).

Named *Row, not Document/Chunk, so they never get confused with the
Pydantic domain models in app/domain/models — services convert a Row into
a domain model before it leaves infrastructure/application code.
"""

from datetime import datetime
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import BigInteger, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.domain.models.document import DocumentStatus

# Must match `vector(384)` from migrations/0003 and
# Settings.embedding_dimensions — a schema-time constant, see ADR 0011.
EMBEDDING_DIMENSIONS = 384


class Base(DeclarativeBase):
    # Every timestamp column in the migrations is timestamptz.
    type_annotation_map = {datetime: DateTime(timezone=True)}

    # Fetch server-side defaults (created_at, ...) back via RETURNING on
    # INSERT, so a freshly-added row is fully populated without a second
    # SELECT — async sessions can't lazy-load a missing attribute later.
    __mapper_args__ = {"eager_defaults": True}


class DocumentRow(Base):
    __tablename__ = "documents"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    tenant_id: Mapped[UUID]
    filename: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, server_default="upload")
    scope: Mapped[str] = mapped_column(Text, server_default="tenant")
    status: Mapped[DocumentStatus] = mapped_column(
        # create_type=False: the Postgres enum is created by the SQL
        # migration, never by SQLAlchemy. values_callable stores the enum's
        # value ("uploaded"), not its Python name ("UPLOADED").
        ENUM(
            DocumentStatus,
            name="document_status",
            create_type=False,
            values_callable=lambda e: [m.value for m in e],
        ),
        server_default=DocumentStatus.UPLOADED.value,
    )
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class DocumentChunkRow(Base):
    __tablename__ = "document_chunks"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    tenant_id: Mapped[UUID]
    scope: Mapped[str] = mapped_column(Text, server_default="tenant")
    chunk_index: Mapped[int]
    content: Mapped[str] = mapped_column(Text)
    char_count: Mapped[int]
    # `metadata` is reserved on declarative classes (it's the Base's table
    # registry), so the attribute is `meta` while the column keeps its name.
    meta: Mapped[dict] = mapped_column("metadata", JSONB, server_default="{}")
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIMENSIONS))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ConversationRow(Base):
    __tablename__ = "conversations"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    tenant_id: Mapped[UUID]
    actor_id: Mapped[str] = mapped_column(Text)
    # Agent run lock — see migrations/0004.
    active_run_id: Mapped[UUID | None]
    locked_until: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class MessageRow(Base):
    __tablename__ = "messages"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    conversation_id: Mapped[UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    tenant_id: Mapped[UUID]
    role: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    run_id: Mapped[UUID | None]
    meta: Mapped[dict] = mapped_column("meta", JSONB, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AgentRunRow(Base):
    __tablename__ = "agent_runs"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    tenant_id: Mapped[UUID]
    conversation_id: Mapped[UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    actor_id: Mapped[str] = mapped_column(Text)
    actor_type: Mapped[str] = mapped_column(Text)
    actor_role: Mapped[str | None] = mapped_column(Text)
    profile: Mapped[str] = mapped_column(Text)
    client_message_id: Mapped[UUID | None]
    status: Mapped[str] = mapped_column(Text, server_default="running")
    models_used: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    iterations: Mapped[int] = mapped_column(server_default="0")
    tool_calls: Mapped[int] = mapped_column(server_default="0")
    input_tokens: Mapped[int] = mapped_column(server_default="0")
    output_tokens: Mapped[int] = mapped_column(server_default="0")
    cached_tokens: Mapped[int] = mapped_column(server_default="0")
    cost_usd_micros: Mapped[int] = mapped_column(BigInteger, server_default="0")
    error_code: Mapped[str | None] = mapped_column(Text)
    response: Mapped[dict | None] = mapped_column(JSONB)
    trace_id: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    ended_at: Mapped[datetime | None]


class AgentStepRow(Base):
    __tablename__ = "agent_steps"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    tenant_id: Mapped[UUID]
    run_id: Mapped[UUID] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"))
    seq: Mapped[int]
    kind: Mapped[str] = mapped_column(Text)
    tool_name: Mapped[str | None] = mapped_column(Text)
    args_redacted: Mapped[dict | None] = mapped_column(JSONB)
    args_hash: Mapped[str | None] = mapped_column(Text)
    policy_decision: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(Text)
    latency_ms: Mapped[int | None]
    result_bytes: Mapped[int | None]
    model: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AgentPendingActionRow(Base):
    __tablename__ = "agent_pending_actions"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    tenant_id: Mapped[UUID]
    actor_id: Mapped[str] = mapped_column(Text)
    actor_type: Mapped[str] = mapped_column(Text)
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"))
    conversation_id: Mapped[UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    tool_name: Mapped[str] = mapped_column(Text)
    args: Mapped[dict] = mapped_column(JSONB)
    args_hash: Mapped[str] = mapped_column(Text)
    card: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    outcome: Mapped[dict | None] = mapped_column(JSONB)
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())
