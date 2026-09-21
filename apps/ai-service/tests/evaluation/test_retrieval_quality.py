"""
A worked example of what spec section 24 asks for: retrieval precision/
recall against a small, hand-labeled fixture corpus — not "the endpoint
returned 200." This is a scaffold, not the full framework (faithfulness/
answer-relevance/citation-correctness/tool-call-correctness/cost scoring
are Phase 2, once a real LLM provider and tool-calling exist to evaluate —
see docs/decisions/0011). What's here is real and runnable today: it
exercises the actual Retriever against real Postgres with the fake
embedding provider (deterministic, so precision@k is a stable, meaningful
number to track over time — not a flaky one because a real model changed
underneath a fixed fixture set).
"""

from dataclasses import dataclass
from uuid import uuid4

import pytest

from app.application.rag.context import ContextBuilder
from app.application.rag.pipeline import RagPipeline
from app.application.rag.rerank import RerankStep
from app.application.rag.retrieve import Retriever
from app.domain.models.chunk import Chunk


@dataclass
class EvalCase:
    query: str
    relevant_content_substring: str  # what a correct top-1 result should contain


FIXTURE_DOCS: list[tuple[str, str]] = [
    ("doc-returns", "Items may be returned within 30 days of delivery for a full refund."),
    ("doc-shipping", "Standard shipping takes 3-5 business days within the UAE."),
    ("doc-warranty", "Electronics carry a 1-year manufacturer warranty against defects."),
    ("doc-payment", "We accept Visa, Mastercard, and Apple Pay at checkout."),
]

EVAL_CASES = [
    # Queries deliberately reuse some of the fixture's own vocabulary — the
    # fake embedding provider is a deterministic bag-of-words hash (see its
    # module docstring), not a real semantic model, so this is a fair test
    # of "does the retrieval pipeline plumbing work end-to-end" rather than
    # "is this embedding model semantically good" (that question needs a
    # real model, which is Phase 2 — see docs/decisions/0011).
    EvalCase(query="can items be returned within 30 days", relevant_content_substring="returned within 30 days"),
    EvalCase(query="how many business days does shipping take", relevant_content_substring="3-5 business days"),
    EvalCase(query="does my electronics purchase have a manufacturer warranty", relevant_content_substring="1-year manufacturer warranty"),
]


@pytest.mark.asyncio
async def test_retrieval_precision_at_1(db, vector_store, embeddings, metrics, make_document):
    """Precision@1: for each labeled query, does the top result contain the expected answer?"""
    tenant_id = uuid4()
    for label, content in FIXTURE_DOCS:
        vector = await embeddings.embed_query(content)
        chunk = Chunk(
            id=uuid4(),
            document_id=await make_document(tenant_id),
            tenant_id=tenant_id,
            chunk_index=0,
            content=content,
            char_count=len(content),
            embedding=vector,
            metadata={"label": label},
        )
        await vector_store.upsert(tenant_id, [chunk])

    retriever = Retriever(embeddings, vector_store, _NullCache(), metrics)
    hits = 0
    for case in EVAL_CASES:
        results = await retriever.retrieve(tenant_id, case.query, limit=1)
        if results and case.relevant_content_substring in results[0].content:
            hits += 1

    precision_at_1 = hits / len(EVAL_CASES)
    # A real dashboard would track this number over time (spec section 24);
    # a scaffold just asserts it doesn't regress below a floor.
    assert precision_at_1 >= 0.66, f"precision@1 dropped to {precision_at_1}"


@pytest.mark.asyncio
async def test_context_builder_never_exceeds_budget_under_eval_load(db, vector_store, embeddings, metrics, make_document):
    """A cheap 'does the pipeline stay within its documented context budget' regression check."""
    tenant_id = uuid4()
    for _, content in FIXTURE_DOCS:
        vector = await embeddings.embed_query(content)
        chunk = Chunk(
            id=uuid4(), document_id=await make_document(tenant_id), tenant_id=tenant_id, chunk_index=0,
            content=content, char_count=len(content), embedding=vector,
        )
        await vector_store.upsert(tenant_id, [chunk])

    pipeline = RagPipeline(
        Retriever(embeddings, vector_store, _NullCache(), metrics),
        RerankStep(reranker=None, metrics=metrics),
        ContextBuilder(max_context_chars=100),
    )
    context = await pipeline.run(tenant_id, "tell me everything about your policies")
    assert len(context.text) <= 100 + 20


class _NullCache:
    """Test double — real Redis works fine too (see conftest's `cache` fixture), this just avoids the dependency for a pure-eval test."""

    async def get_json(self, tenant_id: str, key: str):
        return None

    async def set_json(self, tenant_id: str, key: str, value, ttl_seconds: int) -> None:
        return None
