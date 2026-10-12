"""
Runs the real BAAI/bge-small-en-v1.5 model (downloaded once into the HF
cache, ~130MB) — the point is to prove retrieval is semantic, not just that
the code path runs. Skipped where sentence-transformers isn't installed.
"""

import pytest

pytest.importorskip("sentence_transformers")

from app.infrastructure.embeddings.local import LocalEmbeddingProvider  # noqa: E402


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))  # vectors are unit-normalized


@pytest.fixture(scope="module")
def provider() -> LocalEmbeddingProvider:
    p = LocalEmbeddingProvider("BAAI/bge-small-en-v1.5")
    p.warm_up()
    return p


async def test_outputs_unit_vectors_of_declared_width(provider):
    [vector] = await provider.embed_documents(["Free shipping on orders over AED 200."])
    assert len(vector) == provider.dimensions == 384
    assert abs(sum(v * v for v in vector) - 1.0) < 1e-3


async def test_matches_by_meaning_not_shared_words(provider):
    """'send it back' shares no words with the returns passage — a bag-of-words embedding can't rank it first."""
    returns, shipping = await provider.embed_documents(
        [
            "Unworn items can be returned within 14 days of delivery for a full refund.",
            "Orders ship across the UAE within 2-3 business days.",
        ]
    )
    query = await provider.embed_query("Can I send a jacket back if it doesn't fit?")

    assert _cosine(query, returns) > _cosine(query, shipping)
