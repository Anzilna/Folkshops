"""The only file allowed to import the OpenAI SDK for embeddings.

application/rag code depends on EmbeddingProvider only.
"""

import logging

from openai import AsyncOpenAI

from app.domain.errors import EmbeddingProviderError

logger = logging.getLogger(__name__)

_KNOWN_DIMENSIONS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}


class OpenAIEmbeddingProvider:
    def __init__(self, api_key: str, model: str):
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    @property
    def dimensions(self) -> int:
        if self._model not in _KNOWN_DIMENSIONS:
            raise EmbeddingProviderError(
                f"Unknown embedding model '{self._model}' — add its dimension to _KNOWN_DIMENSIONS "
                "before using it, so EmbeddingRouter's boot-time schema check stays meaningful."
            )
        return _KNOWN_DIMENSIONS[self._model]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            resp = await self._client.embeddings.create(model=self._model, input=texts)
            return [d.embedding for d in resp.data]
        except Exception as exc:
            logger.exception("OpenAI embedding request failed")
            raise EmbeddingProviderError(f"Embedding request failed: {exc}") from exc

    async def embed_query(self, text: str) -> list[float]:
        return (await self.embed_documents([text]))[0]
