import hashlib
import time
from uuid import UUID

from app.domain.interfaces.embedding import EmbeddingProvider
from app.domain.interfaces.vector_store import VectorStore
from app.domain.models.retrieval import RetrievalResult
from app.infrastructure.cache.redis import CacheService
from app.observability.metrics import Metrics

_QUERY_EMBEDDING_CACHE_TTL_SECONDS = 300


class Retriever:
    """
    Query normalization -> query embedding -> vector search (spec section
    9). Hybrid/BM25 is Phase 2 (section 10) — this only does vector search
    today. Query embeddings are cache-aside'd per tenant (repeated/similar
    shopper questions are common and embedding calls cost real money/
    latency) — a cache miss or Redis outage just means "embed it fresh,"
    never a request failure (CacheService already fails open).
    """

    def __init__(
        self,
        embeddings: EmbeddingProvider,
        vector_store: VectorStore,
        cache: CacheService,
        metrics: Metrics,
    ):
        self._embeddings = embeddings
        self._vector_store = vector_store
        self._cache = cache
        self._metrics = metrics

    @staticmethod
    def _normalize(query: str) -> str:
        return " ".join(query.strip().lower().split())

    async def _embed_query_cached(self, tenant_id: UUID, normalized: str) -> list[float]:
        cache_key = f"query-embedding:{hashlib.sha256(normalized.encode()).hexdigest()}"
        cached = await self._cache.get_json(str(tenant_id), cache_key)
        if cached is not None:
            self._metrics.cache_hits.add(1, {"resource": "query_embedding"})
            return cached

        self._metrics.cache_misses.add(1, {"resource": "query_embedding"})
        start = time.monotonic()
        embedding = await self._embeddings.embed_query(normalized)
        self._metrics.embedding_latency.record((time.monotonic() - start) * 1000)

        await self._cache.set_json(str(tenant_id), cache_key, embedding, _QUERY_EMBEDDING_CACHE_TTL_SECONDS)
        return embedding

    async def retrieve(
        self,
        tenant_id: UUID,
        query: str,
        limit: int = 10,
        metadata_filter: dict | None = None,
        include_platform: bool = False,
    ) -> list[RetrievalResult]:
        normalized = self._normalize(query)
        if not normalized:
            return []

        query_embedding = await self._embed_query_cached(tenant_id, normalized)

        start = time.monotonic()
        results = await self._vector_store.search(
            tenant_id, query_embedding, limit, metadata_filter, include_platform
        )
        self._metrics.vector_search_latency.record((time.monotonic() - start) * 1000)

        self._metrics.retrieval_count.record(len(results))
        for r in results:
            self._metrics.retrieval_score.record(r.score)
        return results
