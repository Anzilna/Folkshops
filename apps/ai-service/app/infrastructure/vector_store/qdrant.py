"""
Future implementation (spec section 8) — no Qdrant instance exists in this
project's docker-compose yet, so this is the interface's shape without a
working body, same posture as llm/anthropic.py. Wiring it up: implement the
5 VectorStore methods against a real Qdrant client, add "qdrant" to
vector_store/router.py's branch, done — the RAG pipeline (retrieve.py) never
changes, which is the entire point of this seam (spec section 8's "retriever
-> VectorStore -> PgVectorStore, NOT retriever -> PgVectorStore directly").
"""

from uuid import UUID

from app.domain.models.chunk import Chunk
from app.domain.models.retrieval import RetrievalResult


class QdrantVectorStore:
    def __init__(self, url: str):
        self._url = url

    async def upsert(self, tenant_id: UUID, chunks: list[Chunk]) -> None:
        raise NotImplementedError("QdrantVectorStore is not implemented yet — see this file's module docstring")

    async def search(
        self,
        tenant_id: UUID,
        query_embedding: list[float],
        limit: int = 10,
        metadata_filter: dict | None = None,
        include_platform: bool = False,
    ) -> list[RetrievalResult]:
        raise NotImplementedError("QdrantVectorStore is not implemented yet — see this file's module docstring")

    async def delete(self, tenant_id: UUID, chunk_ids: list[UUID]) -> None:
        raise NotImplementedError("QdrantVectorStore is not implemented yet — see this file's module docstring")

    async def delete_document(self, tenant_id: UUID, document_id: UUID) -> None:
        raise NotImplementedError("QdrantVectorStore is not implemented yet — see this file's module docstring")

    async def health_check(self) -> bool:
        return False
