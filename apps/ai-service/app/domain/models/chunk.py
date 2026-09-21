from uuid import UUID

from pydantic import BaseModel, Field


class Chunk(BaseModel):
    """
    A chunk carries `embedding` only on its way into a VectorStore — once
    persisted, retrieval always returns a RetrievalResult (models/retrieval.py)
    instead, which never carries the raw vector back out to application code
    that has no use for it.
    """

    id: UUID
    document_id: UUID
    tenant_id: UUID
    chunk_index: int
    content: str
    char_count: int
    metadata: dict = Field(default_factory=dict)
    embedding: list[float] | None = None
