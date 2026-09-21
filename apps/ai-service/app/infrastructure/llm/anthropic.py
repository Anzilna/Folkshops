"""
Future provider (spec section 13) — no Anthropic account/key exists in this
project yet, so this is the interface's shape without a working body, same
posture as vector_store/qdrant.py. Wiring it up is: implement generate()/
stream() against LLMRequest/LLMResponse, add "anthropic" to
infrastructure/llm/router.py's branch, done — application/chat code needs
no changes, which is the entire point of the LLMProvider seam.
"""

from collections.abc import AsyncIterator

from app.domain.interfaces.llm import LLMRequest, LLMResponse, LLMStreamEvent


class AnthropicProvider:
    def __init__(self, api_key: str):
        self._api_key = api_key

    async def generate(self, request: LLMRequest) -> LLMResponse:
        raise NotImplementedError("AnthropicProvider is not implemented yet — see this file's module docstring")

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        raise NotImplementedError("AnthropicProvider is not implemented yet — see this file's module docstring")
