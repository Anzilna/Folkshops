"""
The only file that knows document_chunks' table shape / pgvector's
`<=>` cosine-distance operator. RAG code depends on VectorStore only.
"""

import json
import logging
from uuid import UUID

from app.domain.errors import VectorStoreError
from app.domain.models.chunk import Chunk
from app.domain.models.retrieval import RetrievalResult
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
            async with self._db.tenant_context(str(tenant_id)) as conn:
                # Whole-document replace, not incremental upsert — same
                # "replace the whole ordered set" shape as core-api's own
                # product_images gallery. A re-ingested/retried document
                # never leaves stale chunks from a previous attempt behind.
                await conn.execute("DELETE FROM document_chunks WHERE document_id = $1", document_id)
                await conn.executemany(
                    """
                    INSERT INTO document_chunks
                        (id, document_id, tenant_id, chunk_index, content, char_count, metadata, embedding)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    """,
                    [
                        (
                            c.id,
                            c.document_id,
                            c.tenant_id,
                            c.chunk_index,
                            c.content,
                            c.char_count,
                            json.dumps(c.metadata),
                            c.embedding,
                        )
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
    ) -> list[RetrievalResult]:
        try:
            async with self._db.tenant_context(str(tenant_id)) as conn:
                # 1 - cosine_distance = cosine_similarity, so `score` is
                # intuitively "higher is more relevant" for every caller,
                # regardless of which distance operator pgvector uses
                # internally.
                if metadata_filter:
                    rows = await conn.fetch(
                        """
                        SELECT id, document_id, content, metadata, 1 - (embedding <=> $1) AS score
                        FROM document_chunks
                        WHERE metadata @> $2::jsonb
                        ORDER BY embedding <=> $1
                        LIMIT $3
                        """,
                        query_embedding,
                        json.dumps(metadata_filter),
                        limit,
                    )
                else:
                    rows = await conn.fetch(
                        """
                        SELECT id, document_id, content, metadata, 1 - (embedding <=> $1) AS score
                        FROM document_chunks
                        ORDER BY embedding <=> $1
                        LIMIT $2
                        """,
                        query_embedding,
                        limit,
                    )
        except Exception as exc:
            logger.exception("pgvector search failed")
            raise VectorStoreError(f"Vector search failed: {exc}") from exc

        return [
            RetrievalResult(
                chunk_id=r["id"],
                document_id=r["document_id"],
                content=r["content"],
                score=float(r["score"]),
                metadata=json.loads(r["metadata"]) if isinstance(r["metadata"], str) else r["metadata"],
            )
            for r in rows
        ]

    async def delete(self, tenant_id: UUID, chunk_ids: list[UUID]) -> None:
        if not chunk_ids:
            return
        async with self._db.tenant_context(str(tenant_id)) as conn:
            await conn.execute("DELETE FROM document_chunks WHERE id = ANY($1::uuid[])", chunk_ids)

    async def delete_document(self, tenant_id: UUID, document_id: UUID) -> None:
        async with self._db.tenant_context(str(tenant_id)) as conn:
            await conn.execute("DELETE FROM document_chunks WHERE document_id = $1", document_id)

    async def health_check(self) -> bool:
        return await self._db.health_check()
