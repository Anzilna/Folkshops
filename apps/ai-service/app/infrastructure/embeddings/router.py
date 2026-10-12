"""
Not a "routing strategy" in the model-router sense (section 14) — this
selects the ONE configured embedding provider at startup based on
EMBEDDING_PROVIDER, and enforces the schema-time dimension constraint (see
ADR 0011). application/rag code never imports this module; only
api/dependencies.py does, once, at construction time.
"""

import asyncio
import logging

from app.config import Settings
from app.domain.errors import EmbeddingProviderError
from app.domain.interfaces.embedding import EmbeddingProvider
from app.infrastructure.embeddings.fake import FakeEmbeddingProvider
from app.infrastructure.embeddings.local import LocalEmbeddingProvider
from app.infrastructure.embeddings.openai import OpenAIEmbeddingProvider

logger = logging.getLogger(__name__)


def build_embedding_provider(settings: Settings) -> EmbeddingProvider:
    if settings.embedding_provider == "fake":
        provider: EmbeddingProvider = FakeEmbeddingProvider()
    elif settings.embedding_provider == "local":
        provider = LocalEmbeddingProvider(settings.local_embedding_model)
    elif settings.embedding_provider == "openai":
        if not settings.openai_api_key:
            raise EmbeddingProviderError("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai")
        provider = OpenAIEmbeddingProvider(settings.openai_api_key, settings.openai_embedding_model)
    else:
        raise EmbeddingProviderError(f"Unknown EMBEDDING_PROVIDER: {settings.embedding_provider}")

    if provider.dimensions != settings.embedding_dimensions:
        raise EmbeddingProviderError(
            f"{settings.embedding_provider} produces {provider.dimensions}-dim vectors but the schema's "
            f"document_chunks.embedding column is vector({settings.embedding_dimensions}). Changing "
            "embedding model/provider requires a new migration + re-embedding existing chunks, not just "
            "a config change — see docs/decisions/0011."
        )
    return provider


async def warm_up_embeddings(provider: EmbeddingProvider) -> None:
    """
    Loads an in-process model in the background at startup, so the first
    upload/chat usually isn't the one that waits for it (and, on a fresh
    cache, for its download). Callers schedule it as a task, never await it
    inline. Fail open: if loading fails, the next real request retries —
    same posture as CacheService, never bug #15's take-down-the-whole-app
    failure. A request arriving mid-load just waits on the same lock.
    """
    warm_up = getattr(provider, "warm_up", None)
    if warm_up is None:
        return
    try:
        await asyncio.to_thread(warm_up)
    except Exception:
        logger.exception("embedding model warm-up failed; will retry on first use")
