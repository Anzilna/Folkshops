"""
Two responsibilities that are easy to conflate but aren't the same thing:

1. Provider selection (this file) — which vendor SDK backs LLMProvider,
   chosen once at startup from LLM_PROVIDER. This is the vendor swap-seam.
2. Model routing (application/ — not built in Phase 1, MODEL_ROUTER_ENABLED)
   — which MODEL within a provider a given request should use (small/large/
   reasoning, by task/latency/tenant). That's a per-request decision made by
   ModelRouter once it exists; this file has no opinion about it and picks
   exactly one provider instance for the whole process.
"""

from app.config import Settings
from app.domain.errors import LLMProviderError
from app.domain.interfaces.llm import LLMProvider
from app.infrastructure.llm.fake import FakeLLMProvider
from app.infrastructure.llm.openai import OpenAIProvider


def build_llm_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "fake":
        return FakeLLMProvider()
    if settings.llm_provider == "openai":
        if not settings.openai_api_key:
            raise LLMProviderError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
        return OpenAIProvider(settings.openai_api_key)
    raise LLMProviderError(f"Unknown LLM_PROVIDER: {settings.llm_provider}")
