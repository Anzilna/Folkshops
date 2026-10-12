from app.domain.models.retrieval import Citation, RetrievalResult, RetrievedContext


class ContextBuilder:
    """
    Select final chunks, dedupe, enforce a context-length budget, produce a
    model-ready structured object (spec section 12) — never builds a prompt
    string inside the vector store adapter.
    """

    def __init__(self, max_context_chars: int = 6000):
        self._max_context_chars = max_context_chars

    def build(self, results: list[RetrievalResult]) -> RetrievedContext:
        seen_chunk_ids = set()
        selected: list[RetrievalResult] = []
        total_chars = 0
        truncated = False

        for result in results:
            if result.chunk_id in seen_chunk_ids:
                continue
            seen_chunk_ids.add(result.chunk_id)
            if total_chars + len(result.content) > self._max_context_chars:
                truncated = True
                continue
            selected.append(result)
            total_chars += len(result.content)

        text = "\n\n---\n\n".join(r.content for r in selected)
        citations = [Citation(document_id=r.document_id, chunk_id=r.chunk_id, score=r.score) for r in selected]
        return RetrievedContext(
            text=text, citations=citations, passages=[r.content for r in selected], truncated=truncated
        )
