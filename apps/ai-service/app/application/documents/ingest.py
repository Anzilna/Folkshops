"""
DocumentService owns the `documents` table directly (no repository
indirection — Postgres is the fixed source of truth for document metadata,
not a swappable vendor concern the way LLM/embedding/vector-store are; see
docs/decisions/0011 and rule 30's "no unnecessary repository abstractions").

IngestionPipeline is what the worker (workers/document_worker.py,
workers/embedding_worker.py) actually runs — parse -> normalize -> chunk is
one step, embed -> index is a second, separately retryable step (see ADR
0011's "ingestion idempotency" note: a rate-limited embedding call shouldn't
force re-parsing a PDF).
"""

import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select, update

from app.application.documents.chunk import Chunker
from app.application.documents.index import DocumentIndexer
from app.application.documents.parse import normalize_text, parse_document
from app.domain.errors import DocumentNotFound
from app.domain.models.document import Document, DocumentSource, DocumentStatus
from app.infrastructure.messaging.kafka import EventPublisher
from app.infrastructure.persistence.models import DocumentRow
from app.infrastructure.persistence.postgres import Db

logger = logging.getLogger(__name__)


def _to_document(row: DocumentRow) -> Document:
    return Document.model_validate(row, from_attributes=True)


class DocumentService:
    def __init__(self, db: Db, events: EventPublisher):
        self._db = db
        self._events = events

    async def create(self, tenant_id: UUID, filename: str, mime_type: str) -> Document:
        row = DocumentRow(
            id=uuid4(),
            tenant_id=tenant_id,
            filename=filename,
            mime_type=mime_type,
            source=DocumentSource.UPLOAD.value,
            status=DocumentStatus.UPLOADED,
        )
        async with self._db.tenant_context(str(tenant_id)) as session:
            session.add(row)
            # Sends the INSERT now (inside the transaction) so created_at/
            # updated_at come back from Postgres before we read them below.
            await session.flush()
        await self._events.publish_document_event("document.created", tenant_id, row.id)
        return _to_document(row)

    async def get(self, tenant_id: UUID, document_id: UUID) -> Document:
        async with self._db.tenant_context(str(tenant_id)) as session:
            row = await session.get(DocumentRow, document_id)
        if row is None:
            raise DocumentNotFound(f"Document {document_id} not found")
        return _to_document(row)

    async def list_for_tenant(self, tenant_id: UUID, limit: int = 50) -> list[Document]:
        # No tenant_id WHERE clause needed — RLS (set by tenant_context)
        # already restricts the rows Postgres will return.
        stmt = select(DocumentRow).order_by(DocumentRow.created_at.desc()).limit(limit)
        async with self._db.tenant_context(str(tenant_id)) as session:
            rows = (await session.scalars(stmt)).all()
        return [_to_document(r) for r in rows]

    async def _set_status(self, tenant_id: UUID, document_id: UUID, **values) -> None:
        stmt = (
            update(DocumentRow)
            .where(DocumentRow.id == document_id)
            .values(**values, updated_at=datetime.now(UTC))
        )
        async with self._db.tenant_context(str(tenant_id)) as session:
            await session.execute(stmt)

    async def mark_processing(self, tenant_id: UUID, document_id: UUID) -> None:
        await self._set_status(tenant_id, document_id, status=DocumentStatus.PROCESSING)

    async def mark_indexed(self, tenant_id: UUID, document_id: UUID) -> None:
        await self._set_status(tenant_id, document_id, status=DocumentStatus.INDEXED, error=None)
        await self._events.publish_document_event("document.indexed", tenant_id, document_id)

    async def mark_failed(self, tenant_id: UUID, document_id: UUID, error: str) -> None:
        await self._set_status(tenant_id, document_id, status=DocumentStatus.FAILED, error=error[:2000])
        await self._events.publish_document_event("document.failed", tenant_id, document_id)


class IngestionPipeline:
    """Parse -> normalize -> chunk -> embed -> index -> mark indexed.

    Runs inside the worker, never inside the HTTP request (spec section 4).
    """

    def __init__(self, documents: DocumentService, chunker: Chunker, indexer: DocumentIndexer):
        self._documents = documents
        self._chunker = chunker
        self._indexer = indexer

    async def run(self, tenant_id: UUID, document_id: UUID, content: bytes, mime_type: str) -> None:
        await self._documents.mark_processing(tenant_id, document_id)
        try:
            text = normalize_text(parse_document(content, mime_type))
            chunks = self._chunker.chunk(text, document_id, tenant_id)
            await self._indexer.index_chunks(tenant_id, chunks)
            await self._documents.mark_indexed(tenant_id, document_id)
        except Exception as exc:
            logger.exception("ingestion failed for document %s", document_id)
            await self._documents.mark_failed(tenant_id, document_id, str(exc))
            raise
