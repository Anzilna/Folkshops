"""
The agent's tool-calling loop as a LangGraph StateGraph (docs/decisions/0018,
superseding ADR 0015's "no framework graph"). The control flow is unchanged:

    check_limits ──ok──▶ call_model ──tool calls──▶ run_tools ──▶ check_limits
         │                   │                          │
         └─budget/loop─▶ finalize ─▶ END     no calls ─▶ END    change proposed ─▶ END

What LangGraph adds is the explicit graph: each step is a named node, so the
run can be observed step by step (AgentService streams these updates to the
client) and a new step — a planner, a reflection pass — is a new node and
edge, not another branch in a 100-line `while`.

What it deliberately does NOT own: the model (LLMProvider), tool validation,
policy and confirmation (ToolExecutor), budgets, rate limits and persistence.
The nodes only call those, so no safety property depends on the framework.
LangGraph is used for orchestration only; we don't use LangChain's chat-model
or tool wrappers, which would duplicate our vendor seams.
"""

import json
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict
from uuid import UUID

from langgraph.graph import END, StateGraph
from langgraph.types import RunnableConfig

from app.application.agent.tool_executor import RunContext, ToolExecutor
from app.domain.interfaces.llm import LLMMessage, LLMResponse, StopReason
from app.domain.interfaces.tool_provider import ToolStatus
from app.domain.models.agent import RunStatus, ToolActivity
from app.domain.models.chat import Role
from app.domain.models.retrieval import Citation

SAFETY_ANSWER = "Sorry, I can't help with that request."
EMPTY_ANSWER = "Sorry, I couldn't come up with an answer. Could you rephrase that?"
AWAITING_CONFIRMATION_ANSWER = (
    "I've prepared this change — nothing has been applied yet. Review it below and press Confirm to apply it."
)


class AgentState(TypedDict):
    """What flows between nodes. Plain data only — per-run objects live in the config (see RunDeps)."""

    messages: list[LLMMessage]
    activity: list[ToolActivity]
    citations: dict[UUID, Citation]
    pending_ids: list[UUID]
    # Set by call_model when the model asked for tools; consumed by run_tools.
    tool_calls: list[Any]
    answer: str
    status: RunStatus
    error_code: str | None


class RunDeps(TypedDict):
    """Per-run, non-serialisable collaborators — passed in config["configurable"]["deps"], never in state."""

    run: RunContext
    generate: Callable[[list[LLMMessage], bool], Awaitable[LLMResponse]]
    finalize: Callable[[list[LLMMessage]], Awaitable[str]]


def _deps(config: RunnableConfig) -> RunDeps:
    return config["configurable"]["deps"]  # type: ignore[index]


def build_agent_graph(executor: ToolExecutor):
    """Compiled once per process; every run passes its own RunDeps through the config."""

    async def check_limits(state: AgentState, config: RunnableConfig) -> dict:
        # A pure routing step: the decision is made in `route_after_check`.
        return {}

    def route_after_check(state: AgentState, config: RunnableConfig) -> str:
        run = _deps(config)["run"]
        return "finalize" if (run.loop_detected or run.budget.exhausted()) else "call_model"

    async def call_model(state: AgentState, config: RunnableConfig) -> dict:
        deps = _deps(config)
        run = deps["run"]
        resp = await deps["generate"](state["messages"], run.validation_failures > 0)
        if not resp.tool_calls:
            answer = SAFETY_ANSWER if resp.stop_reason is StopReason.SAFETY else (resp.content or EMPTY_ANSWER)
            return {"answer": answer, "tool_calls": []}
        assistant = LLMMessage(
            role=Role.ASSISTANT,
            content=resp.content,
            tool_calls=resp.tool_calls,
            provider_state=resp.provider_state,
        )
        return {"messages": [*state["messages"], assistant], "tool_calls": resp.tool_calls}

    def route_after_model(state: AgentState) -> str:
        return "run_tools" if state["tool_calls"] else END

    async def run_tools(state: AgentState, config: RunnableConfig) -> dict:
        run = _deps(config)["run"]
        calls = state["tool_calls"]
        outcomes = await executor.execute_batch(calls, run)

        messages = list(state["messages"])
        activity = list(state["activity"])
        citations = dict(state["citations"])
        pending_ids = list(state["pending_ids"])
        for call, outcome in zip(calls, outcomes, strict=True):
            messages.append(
                LLMMessage(
                    role=Role.TOOL,
                    content=json.dumps(outcome.for_model(), default=str),
                    tool_call_id=call.id,
                    tool_name=call.name,
                )
            )
            activity.append(ToolActivity(tool=call.name, status=outcome.status.value))
            for c in outcome.citations:
                citations.setdefault(c.chunk_id, c)
            if outcome.status is ToolStatus.REQUIRES_CONFIRMATION and outcome.pending_action_id:
                pending_ids.append(outcome.pending_action_id)

        update: dict = {
            "messages": messages,
            "activity": activity,
            "citations": citations,
            "pending_ids": pending_ids,
            "tool_calls": [],
        }
        if pending_ids:
            # A proposed change ends the run: the card is the answer, and the
            # model is not asked again (it must never "see" the confirmation).
            update.update(status=RunStatus.AWAITING_CONFIRMATION, answer=AWAITING_CONFIRMATION_ANSWER)
        return update

    def route_after_tools(state: AgentState) -> str:
        return END if state["pending_ids"] else "check_limits"

    async def finalize(state: AgentState, config: RunnableConfig) -> dict:
        deps = _deps(config)
        run = deps["run"]
        stop = "loop_detected" if run.loop_detected else run.budget.exhausted()
        answer = await deps["finalize"](state["messages"])
        return {
            "answer": answer,
            "error_code": stop,
            "status": RunStatus.LOOP_DETECTED if stop == "loop_detected" else RunStatus.BUDGET_EXHAUSTED,
        }

    graph = StateGraph(AgentState)
    graph.add_node("check_limits", check_limits)
    graph.add_node("call_model", call_model)
    graph.add_node("run_tools", run_tools)
    graph.add_node("finalize", finalize)
    graph.set_entry_point("check_limits")
    graph.add_conditional_edges("check_limits", route_after_check, {"finalize": "finalize", "call_model": "call_model"})
    graph.add_conditional_edges("call_model", route_after_model, {"run_tools": "run_tools", END: END})
    graph.add_conditional_edges("run_tools", route_after_tools, {"check_limits": "check_limits", END: END})
    graph.add_edge("finalize", END)
    return graph.compile()
