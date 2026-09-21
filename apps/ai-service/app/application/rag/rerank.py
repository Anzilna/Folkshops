import time

from app.domain.interfaces.reranker import Reranker
from app.domain.models.retrieval import RetrievalResult
from app.observability.logging import get_logger
from app.observability.metrics import Metrics

logger = get_logger(__name__)


class RerankStep:
    """Wraps an optional Reranker so the pipeline never has to special-case
    'no reranker configured' vs 'reranker failed.'
    """

    def __init__(self, reranker: Reranker | None, metrics: Metrics):
        self._reranker = reranker
        self._metrics = metrics

    async def apply(self, query: str, results: list[RetrievalResult]) -> list[RetrievalResult]:
        if self._reranker is None:
            return results
        start = time.monotonic()
        try:
            return await self._reranker.rerank(query, results)
        except Exception:
            # Best-effort: retrieval continues in original (vector-similarity)
            # order rather than failing the whole request — spec section 28.
            logger.warning("reranker_failed_continuing_unreranked")
            return results
        finally:
            self._metrics.rerank_latency.record((time.monotonic() - start) * 1000)
