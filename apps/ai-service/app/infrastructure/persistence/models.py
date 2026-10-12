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
from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import ENUM, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.domain.models.document import DocumentStatus

# Must match `vector(1536)` in migrations/0001_init.sql and
# Settings.embedding_dimensions — a schema-time constant, see ADR 0011.
EMBEDDING_DIMENSIONS = 1536


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
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class MessageRow(Base):
    __tablename__ = "messages"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    conversation_id: Mapped[UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    tenant_id: Mapped[UUID]
    role: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
