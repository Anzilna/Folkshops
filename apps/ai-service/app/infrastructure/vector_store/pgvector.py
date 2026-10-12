"""
The only file that knows document_chunks' table shape / pgvector's
`<=>` cosine-distance operator. RAG code depends on VectorStore only.
"""

import logging
from uuid import UUID

from sqlalchemy import delete, insert, select

from app.domain.errors import VectorStoreError
from app.domain.models.chunk import Chunk
from app.domain.models.document import DocumentScope, scope_for
from app.domain.models.retrieval import RetrievalResult
from app.infrastructure.persistence.models import DocumentChunkRow
from app.infrastructure.persistence.postgres import Db

logger = logging.getLogger(__name__)


class PgVectorStore:
    def __init__(self, db: Db):
        self._db = db

    async def upsert(self, tenant_id: UUID, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        document_id = chunks[0].document_id
        try:
            async with self._db.tenant_context(str(tenant_id)) as session:
                # Whole-document replace, not incremental upsert — same
                # "replace the whole ordered set" shape as core-api's own
                # product_images gallery. A re-ingested/retried document
                # never leaves stale chunks from a previous attempt behind.
                await session.execute(delete(DocumentChunkRow).where(DocumentChunkRow.document_id == document_id))
                # insert() + a list of dicts is SQLAlchemy's bulk path — one
                # executemany, not one ORM object per chunk.
                await session.execute(
                    insert(DocumentChunkRow),
                    [
                        {
                            "id": c.id,
                            "document_id": c.document_id,
                            "tenant_id": c.tenant_id,
                            "scope": scope_for(c.tenant_id).value,
                            "chunk_index": c.chunk_index,
                            "content": c.content,
                            "char_count": c.char_count,
                            "meta": c.metadata,
                            "embedding": c.embedding,
                        }
                        for c in chunks
                    ],
                )
        except Exception as exc:
            logger.exception("pgvector upsert failed")
            raise VectorStoreError(f"Failed to upsert chunks: {exc}") from exc

    async def search(
        self,
        tenant_id: UUID,
        query_embedding: list[float],
        limit: int = 10,
        metadata_filter: dict | None = None,
        include_platform: bool = False,
    ) -> list[RetrievalResult]:
        # `embedding <=> :query` in SQL. 1 - cosine_distance =
        # cosine_similarity, so `score` is intuitively "higher is more
        # relevant" for every caller, regardless of which distance operator
        # pgvector uses internally.
        distance = DocumentChunkRow.embedding.cosine_distance(query_embedding)
        stmt = (
            select(
                DocumentChunkRow.id,
                DocumentChunkRow.document_id,
                DocumentChunkRow.content,
                DocumentChunkRow.meta,
                (1 - distance).label("score"),
            )
            .order_by(distance)
            .limit(limit)
        )
        # A NULL embedding is a chunk waiting to be re-embedded after a model
        # switch (migrations/0003) — it has no position in this vector space.
        stmt = stmt.where(DocumentChunkRow.embedding.is_not(None))
        # RLS lets every tenant READ platform rows (migrations/0006), so the
        # default must be an explicit opt-out: a caller that doesn't ask for
        # platform knowledge (the Shopper Assistant) never gets it, even
        # though Postgres would allow it.
        if not include_platform:
            stmt = stmt.where(DocumentChunkRow.scope == DocumentScope.TENANT.value)
        if metadata_filter:
            stmt = stmt.where(DocumentChunkRow.meta.contains(metadata_filter))  # jsonb @>

        try:
            async with self._db.tenant_context(str(tenant_id)) as session:
                rows = (await session.execute(stmt)).all()
        except Exception as exc:
            logger.exception("pgvector search failed")
            raise VectorStoreError(f"Vector search failed: {exc}") from exc

        return [
            RetrievalResult(
                chunk_id=r.id,
                document_id=r.document_id,
                content=r.content,
                score=float(r.score),
                metadata=r.meta,
            )
            for r in rows
        ]

    async def delete(self, tenant_id: UUID, chunk_ids: list[UUID]) -> None:
        if not chunk_ids:
            return
        async with self._db.tenant_context(str(tenant_id)) as session:
            await session.execute(delete(DocumentChunkRow).where(DocumentChunkRow.id.in_(chunk_ids)))

    async def delete_document(self, tenant_id: UUID, document_id: UUID) -> None:
        async with self._db.tenant_context(str(tenant_id)) as session:
            await session.execute(delete(DocumentChunkRow).where(DocumentChunkRow.document_id == document_id))

    async def health_check(self) -> bool:
        return await self._db.health_check()
