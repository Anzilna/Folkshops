from uuid import uuid4

from app.application.rag.context import ContextBuilder
from app.domain.models.retrieval import RetrievalResult


def _result(content: str, score: float, chunk_id=None, document_id=None) -> RetrievalResult:
    return RetrievalResult(
        chunk_id=chunk_id or uuid4(),
        document_id=document_id or uuid4(),
        content=content,
        score=score,
    )


def test_dedupes_by_chunk_id():
    dup_id = uuid4()
    results = [_result("a", 0.9, chunk_id=dup_id), _result("a", 0.9, chunk_id=dup_id)]
    context = ContextBuilder().build(results)
    assert len(context.citations) == 1


def test_enforces_context_char_limit_and_marks_truncated():
    results = [_result("x" * 100, 0.9) for _ in range(5)]
    context = ContextBuilder(max_context_chars=250).build(results)
    assert len(context.text) <= 250 + 20  # small slack for the "---" separators
    assert context.truncated is True


def test_no_truncation_when_everything_fits():
    results = [_result("short", 0.9)]
    context = ContextBuilder(max_context_chars=1000).build(results)
    assert context.truncated is False


def test_citations_correspond_exactly_to_selected_chunks():
    """Citations must never be invented — spec section 19."""
    r1, r2 = _result("a", 0.9), _result("b", 0.8)
    context = ContextBuilder().build([r1, r2])
    cited_chunk_ids = {c.chunk_id for c in context.citations}
    assert cited_chunk_ids == {r1.chunk_id, r2.chunk_id}
