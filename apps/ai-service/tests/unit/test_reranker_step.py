from uuid import uuid4

import pytest

from app.application.rag.rerank import RerankStep
from app.domain.models.retrieval import RetrievalResult
from app.observability.metrics import Metrics


def _result(score: float) -> RetrievalResult:
    return RetrievalResult(chunk_id=uuid4(), document_id=uuid4(), content="x", score=score)


@pytest.fixture
def metrics() -> Metrics:
    return Metrics("test")


@pytest.mark.asyncio
async def test_no_reranker_passes_through_unchanged(metrics):
    results = [_result(0.5), _result(0.9)]
    step = RerankStep(reranker=None, metrics=metrics)
    output = await step.apply("query", results)
    assert output == results


@pytest.mark.asyncio
async def test_reranker_failure_falls_back_to_original_order(metrics):
    class FailingReranker:
        async def rerank(self, query, documents):
            raise RuntimeError("boom")

    results = [_result(0.5), _result(0.9)]
    step = RerankStep(reranker=FailingReranker(), metrics=metrics)
    output = await step.apply("query", results)
    assert output == results  # pipeline continues unreranked, spec section 28


@pytest.mark.asyncio
async def test_working_reranker_reorders_results(metrics):
    class ReverseReranker:
        async def rerank(self, query, documents):
            return list(reversed(documents))

    results = [_result(0.5), _result(0.9)]
    step = RerankStep(reranker=ReverseReranker(), metrics=metrics)
    output = await step.apply("query", results)
    assert output == list(reversed(results))
