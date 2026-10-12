"""Gemini message/response translation — pure functions, no network."""

import json

from google.genai import types

from app.domain.interfaces.llm import LLMMessage, StopReason, ToolCall
from app.domain.models.chat import Role
from app.infrastructure.llm.gemini import from_gemini_response, to_gemini_contents


def _response(parts: list[types.Part], finish: str = "STOP") -> types.GenerateContentResponse:
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts), finish_reason=finish)],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=120, candidates_token_count=30, thoughts_token_count=12, cached_content_token_count=40
        ),
    )


def test_function_calls_and_usage_are_parsed():
    resp = _response(
        [
            types.Part(text="thinking...", thought=True),
            types.Part(function_call=types.FunctionCall(id="call-1", name="get_order", args={"order_id": "abc"})),
        ]
    )
    out = from_gemini_response(resp, "gemini-x")
    assert out.stop_reason is StopReason.TOOL_CALLS
    assert out.tool_calls == [ToolCall(id="call-1", name="get_order", arguments={"order_id": "abc"})]
    assert out.content == ""  # thought text is never surfaced
    assert (out.prompt_tokens, out.completion_tokens, out.cached_tokens) == (120, 42, 40)


def test_missing_call_ids_get_generated_ones_that_are_never_sent_back():
    resp = _response([types.Part(function_call=types.FunctionCall(name="get_cart", args={}))])
    out = from_gemini_response(resp, "gemini-x")
    generated = out.tool_calls[0].id
    contents = to_gemini_contents(
        [
            LLMMessage(role=Role.USER, content="cart?"),
            LLMMessage(role=Role.ASSISTANT, tool_calls=out.tool_calls, provider_state=out.provider_state),
            LLMMessage(
                role=Role.TOOL,
                content=json.dumps({"status": "succeeded"}),
                tool_call_id=generated,
                tool_name="get_cart",
            ),
        ]
    )
    assert contents[2].parts[0].function_response.id is None
    assert contents[2].parts[0].function_response.name == "get_cart"


def test_model_turn_is_replayed_verbatim_including_thought_signatures():
    resp = _response(
        [
            types.Part(
                function_call=types.FunctionCall(id="c1", name="get_cart", args={}),
                thought_signature=b"\x01sig-bytes\xff",
            )
        ]
    )
    out = from_gemini_response(resp, "gemini-x")
    contents = to_gemini_contents(
        [
            LLMMessage(role=Role.USER, content="hi"),
            LLMMessage(role=Role.ASSISTANT, tool_calls=out.tool_calls, provider_state=out.provider_state),
        ]
    )
    assert contents[1].role == "model"
    assert contents[1].parts[0].thought_signature == b"\x01sig-bytes\xff"


def test_consecutive_tool_results_are_grouped_into_one_user_turn():
    contents = to_gemini_contents(
        [
            LLMMessage(role=Role.USER, content="x"),
            LLMMessage(
                role=Role.ASSISTANT,
                tool_calls=[
                    ToolCall(id="a", name="get_product", arguments={}),
                    ToolCall(id="b", name="get_cart", arguments={}),
                ],
            ),
            LLMMessage(role=Role.TOOL, content="{}", tool_call_id="a", tool_name="get_product"),
            LLMMessage(role=Role.TOOL, content="{}", tool_call_id="b", tool_name="get_cart"),
        ]
    )
    assert [c.role for c in contents] == ["user", "model", "user"]
    assert len(contents[2].parts) == 2


def test_blocked_prompt_maps_to_safety():
    out = from_gemini_response(types.GenerateContentResponse(candidates=[]), "gemini-x")
    assert out.stop_reason is StopReason.SAFETY
    assert out.content == ""


def test_safety_finish_reason():
    out = from_gemini_response(_response([types.Part(text="")], finish="SAFETY"), "gemini-x")
    assert out.stop_reason is StopReason.SAFETY
