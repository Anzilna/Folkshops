import pytest

from app.domain.interfaces.llm import LLMMessage, LLMRequest
from app.domain.models.chat import Role
from app.infrastructure.embeddings.fake import FakeEmbeddingProvider
from app.infrastructure.llm.fake import FakeLLMProvider


@pytest.mark.asyncio
async def test_fake_embeddings_are_deterministic():
    provider = FakeEmbeddingProvider()
    a1 = await provider.embed_query("return policy")
    a2 = await provider.embed_query("return policy")
    assert a1 == a2


@pytest.mark.asyncio
async def test_fake_embeddings_differ_for_different_text():
    provider = FakeEmbeddingProvider()
    a = await provider.embed_query("return policy")
    b = await provider.embed_query("shipping times")
    assert a != b


@pytest.mark.asyncio
async def test_fake_llm_reflects_context_presence():
    provider = FakeLLMProvider()
    with_context = await provider.generate(
        LLMRequest(
            model="fake",
            messages=[LLMMessage(role=Role.USER, content="q?")],
            system_prompt="Context:\nsome real retrieved content",
        )
    )
    without_context = await provider.generate(
        LLMRequest(
            model="fake",
            messages=[LLMMessage(role=Role.USER, content="q?")],
            system_prompt="Context:\n(no relevant context found)",
        )
    )
    assert "Based on the provided context" in with_context.content
    assert "Based on the provided context" not in without_context.content
