from typing import Protocol
from uuid import UUID

from app.domain.models.chunk import Chunk
from app.domain.models.retrieval import RetrievalResult


class VectorStore(Protocol):
    """
    Every operation takes tenant_id explicitly and MUST filter/scope by it —
    there is no method on this interface that can search across tenants.
    The one addition is include_platform: Folkshops' own help content
    (docs/decisions/0017), which is shared read-only and opt-in per call.
    The RAG pipeline depends only on this Protocol; it never knows whether
    pgvector or Qdrant is behind it (see docs/decisions/0011).
    """

    async def upsert(self, tenant_id: UUID, chunks: list[Chunk]) -> None: ...

    async def search(
        self,
        tenant_id: UUID,
        query_embedding: list[float],
        limit: int = 10,
        metadata_filter: dict | None = None,
        include_platform: bool = False,
    ) -> list[RetrievalResult]: ...

    async def delete(self, tenant_id: UUID, chunk_ids: list[UUID]) -> None: ...

    async def delete_document(self, tenant_id: UUID, document_id: UUID) -> None: ...

    async def health_check(self) -> bool: ...
