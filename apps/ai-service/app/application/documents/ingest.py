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

from sqlalchemy import delete, func, select, update

from app.application.documents.chunk import Chunker
from app.application.documents.index import DocumentIndexer
from app.application.documents.parse import normalize_text, parse_document
from app.domain.errors import DocumentNotFound
from app.domain.models.document import Document, DocumentPage, DocumentSource, DocumentStatus, scope_for
from app.infrastructure.messaging.kafka import EventPublisher
from app.infrastructure.persistence.models import DocumentRow
from app.infrastructure.persistence.postgres import Db

logger = logging.getLogger(__name__)


_SORTABLE_COLUMNS = {
    "createdAt": DocumentRow.created_at,
    "filename": DocumentRow.filename,
    "status": DocumentRow.status,
}


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
            scope=scope_for(tenant_id).value,
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
        # RLS lets a store READ platform documents too (migrations/0006); they
        # are managed from platform-admin, not through a store's own routes.
        if row is None or row.scope != scope_for(tenant_id).value:
            raise DocumentNotFound(f"Document {document_id} not found")
        return _to_document(row)

    async def list_for_tenant(
        self,
        tenant_id: UUID,
        page: int = 1,
        limit: int = 20,
        search: str | None = None,
        status: DocumentStatus | None = None,
        sort_by: str = "createdAt",
        sort_dir: str = "desc",
    ) -> DocumentPage:
        """
        Same {data,total,page,limit,totalPages} shape as core-api's list
        endpoints, so merchant-admin's DataTable drives it unchanged. No
        tenant_id WHERE clause needed — RLS (set by tenant_context) already
        restricts the rows Postgres will return.
        """
        filters = [DocumentRow.scope == scope_for(tenant_id).value]
        if search:
            filters.append(DocumentRow.filename.ilike(f"%{search}%"))
        if status is not None:
            filters.append(DocumentRow.status == status)

        sort_column = _SORTABLE_COLUMNS.get(sort_by, DocumentRow.created_at)
        order = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        stmt = (
            select(DocumentRow)
            .where(*filters)
            .order_by(order, DocumentRow.id)
            .offset((page - 1) * limit)
            .limit(limit)
        )
        count_stmt = select(func.count()).select_from(DocumentRow).where(*filters)

        async with self._db.tenant_context(str(tenant_id)) as session:
            rows = (await session.scalars(stmt)).all()
            total = await session.scalar(count_stmt) or 0
        return DocumentPage(
            data=[_to_document(r) for r in rows],
            total=total,
            page=page,
            limit=limit,
            totalPages=max(1, -(-total // limit)),
        )

    async def delete(self, tenant_id: UUID, document_id: UUID) -> None:
        """
        A hard delete, unlike core-api's soft-deleted catalog: the whole point
        is that a removed document stops being retrievable, and its chunks
        (and their embeddings) go with it via ON DELETE CASCADE. Nothing else
        references a document — citations in old chat answers are returned
        once, not stored as FKs. A job still in flight for it fails on its
        next status update and leaves nothing behind (see IngestionPipeline).
        """
        async with self._db.tenant_context(str(tenant_id)) as session:
            result = await session.execute(delete(DocumentRow).where(DocumentRow.id == document_id))
        if result.rowcount == 0:
            raise DocumentNotFound(f"Document {document_id} not found")

    async def filenames(self, tenant_id: UUID, document_ids: list[UUID]) -> dict[UUID, str]:
        if not document_ids:
            return {}
        stmt = select(DocumentRow.id, DocumentRow.filename).where(DocumentRow.id.in_(document_ids))
        async with self._db.tenant_context(str(tenant_id)) as session:
            rows = (await session.execute(stmt)).all()
        return {row.id: row.filename for row in rows}

    async def labels(self, tenant_id: UUID, document_ids: list[UUID]) -> dict[UUID, tuple[str, str]]:
        """id -> (filename, scope). Includes platform documents, which a store's RLS context may read."""
        if not document_ids:
            return {}
        stmt = select(DocumentRow.id, DocumentRow.filename, DocumentRow.scope).where(DocumentRow.id.in_(document_ids))
        async with self._db.tenant_context(str(tenant_id)) as session:
            rows = (await session.execute(stmt)).all()
        return {row.id: (row.filename, row.scope) for row in rows}

    async def _set_status(self, tenant_id: UUID, document_id: UUID, **values) -> bool:
        stmt = (
            update(DocumentRow)
            .where(DocumentRow.id == document_id)
            .values(**values, updated_at=datetime.now(UTC))
        )
        async with self._db.tenant_context(str(tenant_id)) as session:
            result = await session.execute(stmt)
        return result.rowcount > 0

    async def mark_processing(self, tenant_id: UUID, document_id: UUID) -> bool:
        """False when the document no longer exists (deleted before its job ran)."""
        return await self._set_status(tenant_id, document_id, status=DocumentStatus.PROCESSING)

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
        if not await self._documents.mark_processing(tenant_id, document_id):
            # Deleted from the knowledge base before (or while a retry of)
            # this job ran — nothing to index, and raising would only make
            # arq retry a job that can never succeed.
            logger.info("skipping ingestion for deleted document %s", document_id)
            return
        try:
            text = normalize_text(parse_document(content, mime_type))
            chunks = self._chunker.chunk(text, document_id, tenant_id)
            await self._indexer.index_chunks(tenant_id, chunks)
            await self._documents.mark_indexed(tenant_id, document_id)
        except Exception as exc:
            logger.exception("ingestion failed for document %s", document_id)
            await self._documents.mark_failed(tenant_id, document_id, str(exc))
            raise
