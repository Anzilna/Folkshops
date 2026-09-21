"""
Disabled by default (RERANKER_ENABLED=false). sentence-transformers (and the
torch it pulls in) is deliberately NOT imported at module scope — only
inside load(), the first time rerank() actually runs, so a process that
never enables reranking never pays that import cost. Same shape as
CLAUDE.md bug #15 (a provider must validate/load its optional dependency
lazily, never at construction/import time, or it breaks every code path
instead of just the one that needed it) — here it's an import rather than a
config check, same fix.
"""

import asyncio
import logging

from app.domain.models.retrieval import RetrievalResult

logger = logging.getLogger(__name__)

_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"


class CrossEncoderReranker:
    def __init__(self):
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import CrossEncoder

            logger.info("loading cross-encoder model %s", _MODEL_NAME)
            self._model = CrossEncoder(_MODEL_NAME)
        return self._model

    async def rerank(self, query: str, documents: list[RetrievalResult]) -> list[RetrievalResult]:
        if not documents:
            return documents
        # CrossEncoder.predict is sync/CPU-bound — offload so it doesn't
        # block the event loop.
        model = await asyncio.to_thread(self._load)
        pairs = [(query, d.content) for d in documents]
        scores = await asyncio.to_thread(model.predict, pairs)
        reranked = [d.model_copy(update={"score": float(s)}) for d, s in zip(documents, scores, strict=True)]
        return sorted(reranked, key=lambda d: d.score, reverse=True)
