"""
In-process embeddings via sentence-transformers. No API key, no network
after the model's first download (cached under HF_HOME). The only file
allowed to import sentence-transformers for embeddings, and it imports it
lazily, so nothing pays torch's import cost unless EMBEDDING_PROVIDER=local
(same reasoning as the reranker, see docs/decisions/0011).

Dimensions come from a fixed table instead of loading the model: the
startup schema check (router.py) stays instant and never downloads anything.
Once the model is loaded, its real width is checked against that table.
"""

import asyncio
import logging
import threading

from app.domain.errors import EmbeddingProviderError

logger = logging.getLogger(__name__)

# model -> (output dimensions, query prefix). BGE models are trained with an
# instruction prefix on the *query* side of query->passage retrieval;
# documents are embedded as-is.
_BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
_KNOWN_MODELS: dict[str, tuple[int, str]] = {
    "BAAI/bge-small-en-v1.5": (384, _BGE_QUERY_PREFIX),
    "BAAI/bge-base-en-v1.5": (768, _BGE_QUERY_PREFIX),
    "sentence-transformers/all-MiniLM-L6-v2": (384, ""),
}


class LocalEmbeddingProvider:
    def __init__(self, model_name: str, batch_size: int = 32):
        if model_name not in _KNOWN_MODELS:
            raise EmbeddingProviderError(
                f"Unknown local embedding model '{model_name}' — add its dimension and query prefix to "
                "_KNOWN_MODELS before using it, so the router's boot-time schema check stays meaningful."
            )
        self._model_name = model_name
        self._dimensions, self._query_prefix = _KNOWN_MODELS[model_name]
        self._batch_size = batch_size
        self._model = None
        self._load_lock = threading.Lock()

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def _get_model(self):
        with self._load_lock:
            if self._model is None:
                from sentence_transformers import SentenceTransformer

                logger.info("loading local embedding model %s", self._model_name)
                model = SentenceTransformer(self._model_name, device="cpu")
                actual = model.get_sentence_embedding_dimension()
                if actual != self._dimensions:
                    raise EmbeddingProviderError(
                        f"{self._model_name} produced {actual}-dim vectors, expected {self._dimensions}"
                    )
                self._model = model
            return self._model

    def warm_up(self) -> None:
        """Loads (and on first run downloads) the model, so the first real request isn't the slow one."""
        self._get_model()

    def _encode(self, texts: list[str]) -> list[list[float]]:
        # normalize_embeddings: unit vectors, so pgvector's cosine distance
        # behaves exactly like a dot product, matching the other providers.
        vectors = self._get_model().encode(
            texts, batch_size=self._batch_size, normalize_embeddings=True, convert_to_numpy=True
        )
        return vectors.tolist()

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            # CPU-bound: run off the event loop so one large document doesn't
            # stall every other request on this process.
            return await asyncio.to_thread(self._encode, texts)
        except EmbeddingProviderError:
            raise
        except Exception as exc:
            logger.exception("local embedding failed")
            raise EmbeddingProviderError(f"Local embedding failed: {exc}") from exc

    async def embed_query(self, text: str) -> list[float]:
        return (await self.embed_documents([self._query_prefix + text]))[0]
