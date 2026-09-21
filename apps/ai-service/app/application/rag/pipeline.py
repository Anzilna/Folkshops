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

    async def run(self, tenant_id: UUID, query: str, retrieval_limit: int = 10) -> RetrievedContext:
        results = await self._retriever.retrieve(tenant_id, query, limit=retrieval_limit)
        results = await self._rerank.apply(query, results)
        return self._context_builder.build(results)
