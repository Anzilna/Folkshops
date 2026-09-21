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

from app.application.documents.chunk import Chunker
from app.application.documents.index import DocumentIndexer
from app.application.documents.parse import normalize_text, parse_document
from app.domain.errors import DocumentNotFound
from app.domain.models.document import Document, DocumentSource, DocumentStatus
from app.infrastructure.messaging.kafka import EventPublisher
from app.infrastructure.persistence.postgres import Db

logger = logging.getLogger(__name__)


def _row_to_document(row) -> Document:
    return Document(
        id=row["id"],
        tenant_id=row["tenant_id"],
        filename=row["filename"],
        mime_type=row["mime_type"],
        source=DocumentSource(row["source"]),
        status=DocumentStatus(row["status"]),
        error=row["error"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class DocumentService:
    def __init__(self, db: Db, events: EventPublisher):
        self._db = db
        self._events = events

    async def create(self, tenant_id: UUID, filename: str, mime_type: str) -> Document:
        doc_id = uuid4()
        async with self._db.tenant_context(str(tenant_id)) as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO documents (id, tenant_id, filename, mime_type, source, status)
                VALUES ($1, $2, $3, $4, 'upload', 'uploaded')
                RETURNING *
                """,
                doc_id,
                tenant_id,
                filename,
                mime_type,
            )
        await self._events.publish_document_event("document.created", tenant_id, doc_id)
        return _row_to_document(row)

    async def get(self, tenant_id: UUID, document_id: UUID) -> Document:
        async with self._db.tenant_context(str(tenant_id)) as conn:
            row = await conn.fetchrow("SELECT * FROM documents WHERE id = $1", document_id)
        if row is None:
            raise DocumentNotFound(f"Document {document_id} not found")
        return _row_to_document(row)

    async def list_for_tenant(self, tenant_id: UUID, limit: int = 50) -> list[Document]:
        async with self._db.tenant_context(str(tenant_id)) as conn:
            rows = await conn.fetch(
                "SELECT * FROM documents ORDER BY created_at DESC LIMIT $1", limit
            )
        return [_row_to_document(r) for r in rows]

    async def mark_processing(self, tenant_id: UUID, document_id: UUID) -> None:
        async with self._db.tenant_context(str(tenant_id)) as conn:
            await conn.execute(
                "UPDATE documents SET status = 'processing', updated_at = $2 WHERE id = $1",
                document_id,
                datetime.now(UTC),
            )

    async def mark_indexed(self, tenant_id: UUID, document_id: UUID) -> None:
        async with self._db.tenant_context(str(tenant_id)) as conn:
            await conn.execute(
                "UPDATE documents SET status = 'indexed', error = NULL, updated_at = $2 WHERE id = $1",
                document_id,
                datetime.now(UTC),
            )
        await self._events.publish_document_event("document.indexed", tenant_id, document_id)

    async def mark_failed(self, tenant_id: UUID, document_id: UUID, error: str) -> None:
        async with self._db.tenant_context(str(tenant_id)) as conn:
            await conn.execute(
                "UPDATE documents SET status = 'failed', error = $2, updated_at = $3 WHERE id = $1",
                document_id,
                error[:2000],
                datetime.now(UTC),
            )
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
