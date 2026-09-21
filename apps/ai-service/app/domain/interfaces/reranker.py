from typing import Protocol

from app.domain.models.retrieval import RetrievalResult


class Reranker(Protocol):
    """Optional by design (RERANKER_ENABLED) — the RAG pipeline must produce correct results with no reranker at all."""

    async def rerank(self, query: str, documents: list[RetrievalResult]) -> list[RetrievalResult]: ...
