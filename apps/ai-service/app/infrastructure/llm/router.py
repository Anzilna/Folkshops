"""
Two responsibilities that are easy to conflate but aren't the same thing:

1. Provider selection (this file) — which vendor SDK backs LLMProvider,
   chosen once at startup from LLM_PROVIDER. This is the vendor swap-seam.
2. Model routing (application/agent/model_router.py) — which MODEL a given
   request uses (fast/standard/fallback, by agent profile). This file only
   supplies each provider's default model ids for those tiers.
"""

from dataclasses import dataclass

from app.config import Settings
from app.domain.errors import LLMProviderError
from app.domain.interfaces.llm import LLMProvider
from app.infrastructure.llm.fake import FakeLLMProvider

# Defaults chosen for Gemini's free tier — both have free quotas and
# support function calling. Override with LLM_MODEL_FAST/STANDARD/FALLBACK.
_GEMINI_DEFAULTS = ("gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite")


@dataclass(frozen=True)
class ModelSet:
    fast: str
    standard: str
    fallback: str | None


def build_llm_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "fake":
        return FakeLLMProvider()
    if settings.llm_provider == "gemini":
        if not settings.gemini_api_key:
            raise LLMProviderError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini")
        # Imported here so the SDK only loads when actually selected.
        from app.infrastructure.llm.gemini import GeminiProvider

        return GeminiProvider(settings.gemini_api_key)
    if settings.llm_provider == "openai":
        if not settings.openai_api_key:
            raise LLMProviderError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
        from app.infrastructure.llm.openai import OpenAIProvider

        return OpenAIProvider(settings.openai_api_key)
    raise LLMProviderError(f"Unknown LLM_PROVIDER: {settings.llm_provider}")


def resolve_models(settings: Settings) -> ModelSet:
    if settings.llm_provider == "gemini":
        fast, standard, fallback = _GEMINI_DEFAULTS
    elif settings.llm_provider == "openai":
        fast = standard = settings.openai_chat_model
        fallback = None
    else:
        fast = standard = "fake"
        fallback = None
    fast = settings.llm_model_fast or fast
    standard = settings.llm_model_standard or standard
    fallback = settings.llm_model_fallback or fallback
    return ModelSet(fast=fast, standard=standard, fallback=fallback)
