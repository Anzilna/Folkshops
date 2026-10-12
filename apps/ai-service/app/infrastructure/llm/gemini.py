"""The only file allowed to import Google's Gemini SDK (google-genai).

Translates the vendor-neutral LLMRequest/LLMResponse to Gemini's
generate_content API and back. Three Gemini specifics are handled here and
nowhere else:

1. Roles: Gemini calls the assistant "model", and tool results go back as
   `function_response` parts inside a "user" turn. Consecutive tool results
   are grouped into one turn, as Gemini expects.
2. Thought signatures: thinking models attach signatures to their parts that
   must be sent back verbatim on the next request of the same tool loop.
   The model's whole Content is serialized into LLMResponse.provider_state
   and replayed as-is, so nothing about the signature format leaks out.
3. Tool schemas go through `parameters_json_schema` (raw JSON Schema), so
   no conversion to Gemini's OpenAPI-subset Schema type is needed.

Automatic function calling is disabled: the SDK must never execute
anything — every tool call goes back to the agent's validator/policy.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator

from google import genai
from google.genai import errors, types

from app.domain.errors import LLMProviderError
from app.domain.interfaces.llm import (
    LLMMessage,
    LLMRequest,
    LLMResponse,
    LLMStreamEvent,
    StopReason,
    ToolCall,
)
from app.domain.models.chat import Role

logger = logging.getLogger(__name__)

# Ids we invent for function calls Gemini returned without one. They're
# never sent back to Gemini (it matches such responses by name/order).
_GENERATED_ID_PREFIX = "gen_"
_RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
_SAFETY_REASONS = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"}
_STATE_KEY = "gemini_content"


def to_gemini_contents(messages: list[LLMMessage]) -> list[types.Content]:
    contents: list[types.Content] = []
    pending_responses: list[types.Part] = []

    def flush_responses() -> None:
        if pending_responses:
            contents.append(types.Content(role="user", parts=list(pending_responses)))
            pending_responses.clear()

    for message in messages:
        if message.role is Role.TOOL:
            response = json.loads(message.content) if message.content else {}
            pending_responses.append(
                types.Part(
                    function_response=types.FunctionResponse(
                        id=None
                        if not message.tool_call_id or message.tool_call_id.startswith(_GENERATED_ID_PREFIX)
                        else message.tool_call_id,
                        name=message.tool_name,
                        response=response,
                    )
                )
            )
            continue

        flush_responses()
        if message.role is Role.USER:
            contents.append(types.Content(role="user", parts=[types.Part(text=message.content)]))
        elif message.role is Role.ASSISTANT:
            state = (message.provider_state or {}).get(_STATE_KEY)
            if state:
                contents.append(types.Content.model_validate_json(state))
                continue
            parts: list[types.Part] = []
            if message.content:
                parts.append(types.Part(text=message.content))
            for call in message.tool_calls:
                parts.append(
                    types.Part(
                        function_call=types.FunctionCall(
                            id=None if call.id.startswith(_GENERATED_ID_PREFIX) else call.id,
                            name=call.name,
                            args=call.arguments,
                        )
                    )
                )
            contents.append(types.Content(role="model", parts=parts or [types.Part(text="")]))
        else:
            # System text goes in system_instruction, never in the turn list.
            raise LLMProviderError(f"Unsupported message role for Gemini: {message.role}")
    flush_responses()
    return contents


def _stop_reason(finish_reason: str | None, has_calls: bool) -> StopReason:
    if has_calls:
        return StopReason.TOOL_CALLS
    if finish_reason in (None, "STOP", "FINISH_REASON_UNSPECIFIED"):
        return StopReason.STOP
    if finish_reason == "MAX_TOKENS":
        return StopReason.MAX_TOKENS
    if finish_reason in _SAFETY_REASONS:
        return StopReason.SAFETY
    return StopReason.OTHER


def from_gemini_response(resp: types.GenerateContentResponse, model: str) -> LLMResponse:
    usage = resp.usage_metadata
    prompt_tokens = (usage.prompt_token_count or 0) if usage else 0
    completion_tokens = ((usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0)) if usage else 0
    cached_tokens = (usage.cached_content_token_count or 0) if usage else 0

    candidate = resp.candidates[0] if resp.candidates else None
    if candidate is None or candidate.content is None:
        # Prompt blocked before any candidate was produced.
        return LLMResponse(
            content="",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cached_tokens=cached_tokens,
            model=model,
            stop_reason=StopReason.SAFETY,
        )

    texts: list[str] = []
    calls: list[ToolCall] = []
    for part in candidate.content.parts or []:
        if part.function_call is not None:
            fc = part.function_call
            calls.append(
                ToolCall(
                    id=fc.id or f"{_GENERATED_ID_PREFIX}{uuid.uuid4().hex}",
                    name=fc.name or "",
                    arguments=dict(fc.args or {}),
                )
            )
        elif part.text and not part.thought:
            texts.append(part.text)

    finish = candidate.finish_reason.value if candidate.finish_reason is not None else None
    return LLMResponse(
        content="".join(texts).strip(),
        tool_calls=calls,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        model=model,
        stop_reason=_stop_reason(finish, bool(calls)),
        provider_state={_STATE_KEY: candidate.content.model_dump_json(exclude_none=True)},
    )


class GeminiProvider:
    def __init__(self, api_key: str, timeout_s: float = 30.0):
        self._client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=int(timeout_s * 1000)))

    async def generate(self, request: LLMRequest) -> LLMResponse:
        config = types.GenerateContentConfig(
            system_instruction=request.system_prompt,
            temperature=request.temperature,
            max_output_tokens=request.max_tokens,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            tools=[
                types.Tool(
                    function_declarations=[
                        types.FunctionDeclaration(
                            name=t.name, description=t.description, parameters_json_schema=t.parameters
                        )
                        for t in request.tools
                    ]
                )
            ]
            if request.tools
            else None,
        )
        try:
            resp = await self._client.aio.models.generate_content(
                model=request.model, contents=to_gemini_contents(request.messages), config=config
            )
        except errors.APIError as exc:
            logger.warning("gemini request failed: status=%s", exc.code)
            raise LLMProviderError(f"LLM request failed ({exc.code})", retryable=exc.code in _RETRYABLE_STATUS) from exc
        except LLMProviderError:
            raise
        except Exception as exc:
            # Timeouts and connection errors from the HTTP layer underneath.
            logger.warning("gemini transport error: %s", type(exc).__name__)
            raise LLMProviderError(f"LLM request failed: {type(exc).__name__}", retryable=True) from exc
        return from_gemini_response(resp, request.model)

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        raise NotImplementedError("Streaming is Phase 2 — see docs/decisions/0011")
