# 0018 — The agent loop is a LangGraph StateGraph

Status: accepted, built and verified (2026-10-02). Supersedes the "not a framework graph" part of ADR 0015.

## Decision

`application/agent/graph.py` builds the tool-calling loop as a LangGraph `StateGraph`. The control flow is identical to the hand-written loop it replaced:

```
check_limits ──ok──▶ call_model ──tool calls──▶ run_tools ──▶ check_limits
     │                   │                          │
     └─budget/loop─▶ finalize ─▶ END     no calls ─▶ END    change proposed ─▶ END
```

`AgentService` keeps everything around the graph: conversation + dedupe, the tenant daily budget, the run lock, history, persistence of runs/steps, metrics and tracing, and the final response. Only the inner `while` became the graph.

## Why LangGraph (and why only LangGraph)

- The loop was already a state machine; an explicit graph makes each step a named node, so the run can be **observed step by step**. `AgentService.chat(..., on_event=...)` forwards one event per finished tool call, and `POST /agent/chat/stream` (SSE) sends them to the browser, which shows live progress ("Searched products") beside the typing dots. Before, the client saw nothing until the whole run ended.
- New capabilities are new nodes and edges (a planner step, a reflection pass, a second specialist) instead of more branches in one function.
- **Not** LangChain's chat-model or tool wrappers: our `LLMProvider` (Gemini quirks, fallback, pricing) and `ToolExecutor` (validation, policy, confirmation) are the vendor/safety seams and stay the boundary. The graph's nodes only *call* them, so no safety property depends on the framework. `langgraph` is imported in `graph.py` only; `langchain-core` arrives as its dependency.
- No checkpointer: run state is persisted by our own `agent_runs`/`agent_steps`/`agent_pending_actions` (and the confirmation flow is a server-built card the user clicks, not a graph interrupt). Revisit if a multi-turn resumable workflow appears.

## Streaming: what it is and isn't

Per **step**, not per token — `LLMProvider.generate` is not streaming. Token streaming needs a `stream()` on each provider adapter (Gemini/OpenAI); that is the next step if wanted. The stream's `done` event carries the same body as `POST /agent/chat`, so a client that loses the progress events (e.g. a buffering proxy) still gets the correct answer. The run executes in its own task and the stream only reads a queue, so a disconnecting browser does not abort a run mid-way (a proposed change, the run record and the lock release still complete).

## Verification

The pre-existing agent suite (loop, budget exhaustion, loop detection, confirmation gate, tenant isolation, idempotent resend) passes unchanged on the graph. Added: progress events per tool step, partial tool activity surviving a later LLM failure, and the SSE endpoint (auth, plan gate, final body). `recursion_limit` is only a backstop above the `RunBudget`, which is what actually bounds a run.
