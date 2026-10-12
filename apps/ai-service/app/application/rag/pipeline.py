from uuid import UUID

from app.application.rag.context import ContextBuilder
from app.application.rag.rerank import RerankStep
from app.application.rag.retrieve import Retriever
from app.domain.models.retrieval import RetrievedContext


class RagPipeline:
    """
    User question -> normalize -> embed -> vector retrieval -> [rerank] ->
    context construction (spec section 9). Stops here — calling the LLM is
    chat_service's job, so this pipeline is reusable by anything that needs
    "context for a query" without needing a whole chat turn (e.g. a future
    non-chat RAG endpoint).
    """

    def __init__(self, retriever: Retriever, rerank: RerankStep, context_builder: ContextBuilder):
        self._retriever = retriever
        self._rerank = rerank
        self._context_builder = context_builder

    async def run(
        self,
        tenant_id: UUID,
        query: str,
        retrieval_limit: int = 10,
        min_score: float | None = None,
        include_platform: bool = False,
    ) -> RetrievedContext:
        results = await self._retriever.retrieve(
            tenant_id, query, limit=retrieval_limit, include_platform=include_platform
        )
        # Applied before reranking: it's a floor on vector similarity, and a
        # reranker's scores are on a different scale.
        if min_score is not None:
            results = [r for r in results if r.score >= min_score]
        results = await self._rerank.apply(query, results)
        return self._context_builder.build(results)
