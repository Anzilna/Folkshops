from uuid import UUID

from pydantic import BaseModel


class RetrievalResult(BaseModel):
    """Structured retrieval output — never a bare dict (spec rule: no random dicts for RAG results)."""

    chunk_id: UUID
    document_id: UUID
    content: str
    score: float
    metadata: dict = {}


class Citation(BaseModel):
    """A citation must correspond 1:1 to a chunk that was actually retrieved — never invented. See ContextBuilder."""

    document_id: UUID
    chunk_id: UUID
    score: float


class RetrievedContext(BaseModel):
    """The ContextBuilder's output — a model-ready, deduplicated, limit-enforced context, not a raw chunk list."""

    text: str
    citations: list[Citation]
    truncated: bool
