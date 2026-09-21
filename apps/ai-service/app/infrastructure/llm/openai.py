"""The only file allowed to import the OpenAI SDK for chat completions.

application/chat code depends on LLMProvider only.
"""

import logging
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from app.domain.errors import LLMProviderError
from app.domain.interfaces.llm import LLMRequest, LLMResponse, LLMStreamEvent

logger = logging.getLogger(__name__)


class OpenAIProvider:
    def __init__(self, api_key: str):
        self._client = AsyncOpenAI(api_key=api_key)

    async def generate(self, request: LLMRequest) -> LLMResponse:
        messages = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        messages.extend({"role": m.role.value, "content": m.content} for m in request.messages)

        try:
            resp = await self._client.chat.completions.create(
                model=request.model,
                messages=messages,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
            )
        except Exception as exc:
            logger.exception("OpenAI chat completion failed")
            raise LLMProviderError(f"LLM request failed: {exc}") from exc

        choice = resp.choices[0]
        return LLMResponse(
            content=choice.message.content or "",
            prompt_tokens=resp.usage.prompt_tokens if resp.usage else 0,
            completion_tokens=resp.usage.completion_tokens if resp.usage else 0,
        )

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        # Phase 2 (spec section 18) — not wired to any route yet.
        raise NotImplementedError("Streaming is Phase 2 — see docs/decisions/0011")
