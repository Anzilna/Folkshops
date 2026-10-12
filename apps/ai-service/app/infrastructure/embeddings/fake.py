"""
Deterministic, no-network embedding provider — the dev/test analog of
ConsoleOtpProvider (see docs/decisions/0011). Not random: the same text
always produces the same vector, and similar text should score as more
similar than dissimilar text, so retrieval tests against it are meaningful
rather than a coin flip.
"""

import hashlib

# Matches the schema's vector(384) column (migrations/0003), so the fake
# provider keeps working in tests without its own migration.
_DIM = 384


def _fake_vector(text: str) -> list[float]:
    # Hash-based bag-of-words: each token perturbs a deterministic subset of
    # dimensions. Crude, but enough that "return policy" and "returns and
    # refunds" land closer together than "return policy" and "shipping
    # times" — sufficient for exercising the retrieval pipeline without a
    # real model.
    vec = [0.0] * _DIM
    for token in text.lower().split():
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        for i in range(0, len(digest), 2):
            idx = int.from_bytes(digest[i : i + 2], "big") % _DIM
            vec[idx] += 1.0
    norm = sum(v * v for v in vec) ** 0.5
    return [v / norm for v in vec] if norm > 0 else vec


class FakeEmbeddingProvider:
    @property
    def dimensions(self) -> int:
        return _DIM

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [_fake_vector(t) for t in texts]

    async def embed_query(self, text: str) -> list[float]:
        return _fake_vector(text)
