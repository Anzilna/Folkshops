"""
Deterministic, no-network LLM — dev/test analog of ConsoleOtpProvider (see
docs/decisions/0011). Echoes the user's question plus whatever context was
handed to it in the system prompt, so a RAG round-trip is verifiable
end-to-end (retrieval actually happened, its content actually reached the
prompt) without a paid vendor call.
"""

from collections.abc import AsyncIterator

from app.domain.interfaces.llm import LLMRequest, LLMResponse, LLMStreamEvent


class FakeLLMProvider:
    async def generate(self, request: LLMRequest) -> LLMResponse:
        question = request.messages[-1].content if request.messages else ""
        has_context = bool(
            request.system_prompt
            and "Context:" in request.system_prompt
            and "(no relevant context found)" not in request.system_prompt
        )
        if has_context:
            answer = f"[fake-llm] Based on the provided context, here is an answer to: {question}"
        else:
            answer = f"[fake-llm] {question}"
        return LLMResponse(content=answer, prompt_tokens=0, completion_tokens=0)

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        raise NotImplementedError("Streaming is Phase 2 — see docs/decisions/0011")
