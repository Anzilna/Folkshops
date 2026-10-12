"""The only file allowed to import the OpenAI SDK for chat completions.

application/chat code depends on LLMProvider only.
"""

import json
import logging
from collections.abc import AsyncIterator

import openai
from openai import AsyncOpenAI

from app.domain.errors import LLMProviderError
from app.domain.interfaces.llm import LLMRequest, LLMResponse, LLMStreamEvent, StopReason, ToolCall
from app.domain.models.chat import Role

logger = logging.getLogger(__name__)


def _to_openai_messages(request: LLMRequest) -> list[dict]:
    messages: list[dict] = []
    if request.system_prompt:
        messages.append({"role": "system", "content": request.system_prompt})
    for m in request.messages:
        if m.role is Role.TOOL:
            messages.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content})
        elif m.role is Role.ASSISTANT and m.tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": m.content or None,
                    "tool_calls": [
                        {
                            "id": c.id,
                            "type": "function",
                            "function": {"name": c.name, "arguments": json.dumps(c.arguments)},
                        }
                        for c in m.tool_calls
                    ],
                }
            )
        else:
            messages.append({"role": m.role.value, "content": m.content})
    return messages


def _parse_arguments(raw: str) -> dict:
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError:
        parsed = None
    # Malformed JSON becomes an argument the tool's model rejects (extra
    # keys are forbidden), so the model gets a validation error to fix
    # rather than the call silently running with no arguments.
    return parsed if isinstance(parsed, dict) else {"_unparseable_arguments": raw}


class OpenAIProvider:
    def __init__(self, api_key: str):
        self._client = AsyncOpenAI(api_key=api_key)

    async def generate(self, request: LLMRequest) -> LLMResponse:
        kwargs: dict = {}
        if request.tools:
            kwargs["tools"] = [
                {
                    "type": "function",
                    "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
                }
                for t in request.tools
            ]
        try:
            resp = await self._client.chat.completions.create(
                model=request.model,
                messages=_to_openai_messages(request),
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                **kwargs,
            )
        except (
            openai.RateLimitError,
            openai.APITimeoutError,
            openai.APIConnectionError,
            openai.InternalServerError,
        ) as exc:
            logger.warning("OpenAI chat completion failed (retryable): %s", type(exc).__name__)
            raise LLMProviderError(f"LLM request failed: {type(exc).__name__}", retryable=True) from exc
        except Exception as exc:
            logger.exception("OpenAI chat completion failed")
            raise LLMProviderError(f"LLM request failed: {exc}") from exc

        choice = resp.choices[0]
        calls = [
            ToolCall(id=c.id, name=c.function.name, arguments=_parse_arguments(c.function.arguments))
            for c in (choice.message.tool_calls or [])
            if c.type == "function"
        ]
        details = getattr(resp.usage, "prompt_tokens_details", None) if resp.usage else None
        stop = {"length": StopReason.MAX_TOKENS, "content_filter": StopReason.SAFETY}.get(
            choice.finish_reason, StopReason.TOOL_CALLS if calls else StopReason.STOP
        )
        return LLMResponse(
            content=choice.message.content or "",
            tool_calls=calls,
            prompt_tokens=resp.usage.prompt_tokens if resp.usage else 0,
            completion_tokens=resp.usage.completion_tokens if resp.usage else 0,
            cached_tokens=(getattr(details, "cached_tokens", 0) or 0) if details else 0,
            model=request.model,
            stop_reason=stop,
        )

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        # Phase 2 (spec section 18) — not wired to any route yet.
        raise NotImplementedError("Streaming is Phase 2 — see docs/decisions/0011")
