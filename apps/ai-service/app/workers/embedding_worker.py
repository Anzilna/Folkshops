"""
reembed_document: re-embeds a document's ALREADY-parsed-and-chunked content
(document_chunks.content is untouched, only the embedding column is
recomputed) — the operational task for "embedding model A -> B" (spec
section 32's swap requirement) without re-parsing the original file or
touching the RAG pipeline. Not wired to an HTTP route in Phase 1 (no caller
needs it yet beyond an operator running it manually), registered as a real
arq job so it's genuinely runnable, not a dead stub — see
document_worker.py's module docstring.

Triggered manually, e.g.:
    python -c "
    import asyncio
    from arq import create_pool
    from arq.connections import RedisSettings
    async def main():
        pool = await create_pool(RedisSettings.from_dsn('redis://localhost:6379'))
        await pool.enqueue_job('reembed_document', '<tenant_id>', '<document_id>')
    asyncio.run(main())
    "
"""

import logging
from uuid import UUID

from sqlalchemy import select

from app.application.documents.index import DocumentIndexer
from app.domain.models.chunk import Chunk
from app.infrastructure.persistence.models import DocumentChunkRow

logger = logging.getLogger(__name__)


async def reembed_document(ctx: dict, tenant_id: str, document_id: str) -> None:
    db = ctx["db"]
    indexer: DocumentIndexer = ctx["indexer"]
    tenant_uuid, doc_uuid = UUID(tenant_id), UUID(document_id)

    # Explicit columns, not select(DocumentChunkRow): the old embedding is
    # about to be replaced, no point pulling 384 floats per chunk back out.
    stmt = (
        select(
            DocumentChunkRow.id,
            DocumentChunkRow.chunk_index,
            DocumentChunkRow.content,
            DocumentChunkRow.char_count,
            DocumentChunkRow.meta,
        )
        .where(DocumentChunkRow.document_id == doc_uuid)
        .order_by(DocumentChunkRow.chunk_index)
    )
    async with db.tenant_context(tenant_id) as session:
        rows = (await session.execute(stmt)).all()

    if not rows:
        logger.warning("reembed_document: no chunks found for document %s", document_id)
        return

    chunks = [
        Chunk(
            id=r.id,
            document_id=doc_uuid,
            tenant_id=tenant_uuid,
            chunk_index=r.chunk_index,
            content=r.content,
            char_count=r.char_count,
            metadata=r.meta,
        )
        for r in rows
    ]
    await indexer.index_chunks(tenant_uuid, chunks)
    logger.info("reembed_document: re-embedded %d chunks for document %s", len(chunks), document_id)
