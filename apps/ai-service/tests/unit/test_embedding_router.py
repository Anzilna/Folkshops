import pytest

from app.config import Settings
from app.domain.errors import EmbeddingProviderError
from app.infrastructure.embeddings.router import build_embedding_provider


def test_fake_provider_is_selected_by_config():
    settings = Settings(EMBEDDING_PROVIDER="fake", EMBEDDING_DIMENSIONS=384)
    provider = build_embedding_provider(settings)
    assert provider.dimensions == 384


def test_dimension_mismatch_refuses_to_boot():
    """A provider producing a different width than the schema's fixed vector(N) column must fail loudly, not silently corrupt data — see ADR 0011."""
    settings = Settings(EMBEDDING_PROVIDER="fake", EMBEDDING_DIMENSIONS=99)
    with pytest.raises(EmbeddingProviderError):
        build_embedding_provider(settings)


def test_unknown_provider_raises():
    settings = Settings(EMBEDDING_PROVIDER="not-a-real-provider")
    with pytest.raises(EmbeddingProviderError):
        build_embedding_provider(settings)


def test_openai_provider_requires_api_key():
    settings = Settings(EMBEDDING_PROVIDER="openai", OPENAI_API_KEY=None)
    with pytest.raises(EmbeddingProviderError):
        build_embedding_provider(settings)


def test_local_provider_is_selected_without_loading_the_model():
    """Boot-time check uses the declared width only — selecting the provider must never download/load weights."""
    settings = Settings(
        EMBEDDING_PROVIDER="local", LOCAL_EMBEDDING_MODEL="BAAI/bge-small-en-v1.5", EMBEDDING_DIMENSIONS=384
    )
    provider = build_embedding_provider(settings)
    assert provider.dimensions == 384
    assert provider._model is None


def test_local_provider_rejects_unknown_model():
    settings = Settings(EMBEDDING_PROVIDER="local", LOCAL_EMBEDDING_MODEL="someone/unknown-model")
    with pytest.raises(EmbeddingProviderError):
        build_embedding_provider(settings)


def test_local_provider_width_mismatch_refuses_to_boot():
    settings = Settings(
        EMBEDDING_PROVIDER="local", LOCAL_EMBEDDING_MODEL="BAAI/bge-base-en-v1.5", EMBEDDING_DIMENSIONS=384
    )
    with pytest.raises(EmbeddingProviderError):
        build_embedding_provider(settings)
