from uuid import UUID

from app.domain.interfaces.embedding import EmbeddingProvider
from app.domain.interfaces.vector_store import VectorStore
from app.domain.models.chunk import Chunk


class DocumentIndexer:
    """Embeds a set of chunks and writes them to the vector store.

    The shared last step of ingestion and re-indexing.
    """

    def __init__(self, embeddings: EmbeddingProvider, vector_store: VectorStore):
        self._embeddings = embeddings
        self._vector_store = vector_store

    async def index_chunks(self, tenant_id: UUID, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        vectors = await self._embeddings.embed_documents([c.content for c in chunks])
        embedded = [c.model_copy(update={"embedding": v}) for c, v in zip(chunks, vectors, strict=True)]
        await self._vector_store.upsert(tenant_id, embedded)
