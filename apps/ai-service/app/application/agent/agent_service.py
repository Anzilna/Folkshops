"""
The agent run (docs/decisions/0015, 0018). The tool-calling loop itself is a
LangGraph StateGraph (graph.py); this service is everything around it:

  resolve conversation -> dedupe resend -> tenant daily budget -> run lock
  -> load history -> [ graph: check limits -> LLM -> tools -> ... -> answer ]
  -> finalize (answer, citations, action cards, activity) -> persist -> unlock

The graph stops on: a final answer; a proposed change awaiting confirmation
(no further model call — the card is the answer); the run's budget
(iterations, tokens, wall clock) or a repeated-call loop, after which the
model gets one last chance to answer without acting. It never loops
unbounded. `on_event` (optional) receives a progress event per finished tool
step, which is what the streaming endpoint forwards to the browser.

The model proposes; everything it proposes passes through ToolExecutor
(validation, policy, confirmation) and core-api's own guards and RLS.
"""

import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from app.application.agent.budget import LlmPricing, RunBudget
from app.application.agent.confirmation import ConfirmationService
from app.application.agent.graph import AgentState, RunDeps, build_agent_graph
from app.application.agent.model_router import ModelRouter
from app.application.agent.profiles import AgentProfile, profile_for
from app.application.agent.prompts import FINALIZE_INSTRUCTION
from app.application.agent.store import AgentStore
from app.application.agent.tool_executor import RunContext, ToolExecutor
from app.application.agent.tool_registry import RunTools, ToolRegistry
from app.domain.errors import AgentBudgetExceeded, ConversationBusy, LLMProviderError
from app.domain.interfaces.llm import LLMMessage, LLMProvider, LLMRequest, LLMResponse, ToolDefinition
from app.domain.interfaces.tool_provider import ActorContext
from app.domain.models.agent import (
    ActionCard,
    AgentChatRequest,
    AgentChatResponse,
    RunStatus,
)
from app.domain.models.chat import Role
from app.infrastructure.cache.redis import RateLimiter
from app.infrastructure.persistence.models import AgentRunRow, AgentStepRow
from app.observability.logging import get_logger
from app.observability.metrics import Metrics
from app.observability.tracing import get_tracer

logger = get_logger(__name__)
tracer = get_tracer(__name__)

_LOCK_GRACE_S = 30.0
_GLOBAL_LLM_KEY = "ai:llm:global-rpm"
_TENANT_LLM_KEY = "ai:llm:tenant-rpm:{tenant_id}"
_BUSY_ANSWER = "The assistant is busy right now. Please try again in a minute."

# A progress event sink: awaited with {"type": "tool", "tool": ..., "status": ...} per finished tool call.
EventSink = Callable[[dict[str, Any]], Awaitable[None]]


class AgentService:
    def __init__(
        self,
        *,
        store: AgentStore,
        registry: ToolRegistry,
        executor: ToolExecutor,
        confirmations: ConfirmationService,
        llm: LLMProvider,
        router: ModelRouter,
        pricing: LlmPricing,
        metrics: Metrics,
        rate_limiter: RateLimiter,
        llm_global_rpm: int,
        tenant_daily_runs: int,
        llm_tenant_rpm: int = 0,
    ):
        self._store = store
        self._registry = registry
        self._executor = executor
        self._confirmations = confirmations
        self._llm = llm
        self._router = router
        self._pricing = pricing
        self._metrics = metrics
        self._rate_limiter = rate_limiter
        self._llm_global_rpm = llm_global_rpm
        self._llm_tenant_rpm = llm_tenant_rpm
        self._tenant_daily_runs = tenant_daily_runs
        self._graph = build_agent_graph(executor)

    async def chat(
        self, actor: ActorContext, request: AgentChatRequest, on_event: EventSink | None = None
    ) -> AgentChatResponse:
        tenant_id = UUID(actor.tenant_id)
        profile = profile_for(actor)
        conversation_id = await self._store.get_or_create_conversation(
            tenant_id, actor.actor_id, request.conversation_id
        )

        if request.client_message_id is not None:
            previous = await self._store.find_response_for_client_message(
                tenant_id, conversation_id, request.client_message_id
            )
            if previous is not None:
                return AgentChatResponse.model_validate(previous)

        since = datetime.now(UTC) - timedelta(days=1)
        if await self._store.runs_since(tenant_id, since) >= self._tenant_daily_runs:
            raise AgentBudgetExceeded("This store has reached its daily assistant limit. Please try again tomorrow.")

        run_id = uuid4()
        if not await self._store.acquire_lock(
            tenant_id, conversation_id, run_id, profile.limits.wall_clock_s + _LOCK_GRACE_S
        ):
            raise ConversationBusy("Still working on your previous message.")

        try:
            return await self._run(actor, profile, conversation_id, run_id, request, on_event)
        finally:
            await self._store.release_lock(tenant_id, conversation_id, run_id)

    async def _run(
        self,
        actor: ActorContext,
        profile: AgentProfile,
        conversation_id: UUID,
        run_id: UUID,
        request: AgentChatRequest,
        on_event: EventSink | None = None,
    ) -> AgentChatResponse:
        tenant_id = UUID(actor.tenant_id)
        history = await self._store.history(tenant_id, conversation_id, profile.limits.history_messages)

        with tracer.start_as_current_span("agent.run") as span:
            span.set_attribute("agent.run_id", str(run_id))
            span.set_attribute("agent.profile", profile.name)
            span.set_attribute("tenant.id", actor.tenant_id)
            trace_id = format(span.get_span_context().trace_id, "032x")

            await self._store.create_run(
                AgentRunRow(
                    id=run_id,
                    tenant_id=tenant_id,
                    conversation_id=conversation_id,
                    actor_id=actor.actor_id,
                    actor_type=actor.actor_type,
                    actor_role=actor.role,
                    profile=profile.name,
                    client_message_id=request.client_message_id,
                    trace_id=trace_id,
                )
            )
            await self._store.store_message(tenant_id, conversation_id, Role.USER, request.message, run_id)

            budget = RunBudget(profile.limits)
            messages = [LLMMessage(role=role, content=content) for role, content in history]
            messages.append(LLMMessage(role=Role.USER, content=request.message))
            models_used: list[str] = []
            activity = []
            citations = {}
            pending_ids: list[UUID] = []
            status = RunStatus.COMPLETED
            answer = ""
            error_code: str | None = None
            run: RunContext | None = None

            try:
                async with self._registry.open(profile.name, actor) as tools:
                    span.set_attribute("agent.tools_visible", len(tools.specs))
                    run = RunContext(
                        run_id=run_id,
                        tenant_id=tenant_id,
                        actor=actor,
                        tools=tools,
                        budget=budget,
                        propose=lambda spec, args, run_tools: self._confirmations.propose(
                            actor=actor,
                            run_id=run_id,
                            conversation_id=conversation_id,
                            spec=spec,
                            args=args,
                            tools=run_tools,
                        ),
                    )
                    initial: AgentState = {
                        "messages": messages,
                        "activity": [],
                        "citations": {},
                        "pending_ids": [],
                        "tool_calls": [],
                        "answer": "",
                        "status": RunStatus.COMPLETED,
                        "error_code": None,
                    }
                    deps: RunDeps = {
                        "run": run,
                        "generate": lambda msgs, escalate: self._generate(
                            profile, msgs, tools.definitions(), run, models_used, escalate=escalate
                        ),
                        "finalize": lambda msgs: self._finalize(profile, msgs, tools, run, models_used),
                    }
                    # Each iteration is 3 graph steps (limits, model, tools); the RunBudget — not this
                    # number — is what actually bounds a run, this is only a backstop above it.
                    config = {
                        "recursion_limit": 3 * profile.limits.max_iterations + 10,
                        "configurable": {"deps": deps},
                    }
                    reported = 0
                    async for state in self._graph.astream(initial, config, stream_mode="values"):
                        # Mirrored out each step so that if a later step raises (LLM down), the tool
                        # outcomes that already happened are still reported, never hidden.
                        activity, citations, pending_ids = state["activity"], state["citations"], state["pending_ids"]
                        if on_event is not None:
                            for step in activity[reported:]:
                                await on_event({"type": "tool", "tool": step.tool, "status": step.status})
                        reported = len(activity)
                    answer, status, error_code = state["answer"], state["status"], state["error_code"]
            except LLMProviderError as exc:
                # Vendor down or out of quota even after the fallback: a clear
                # answer, not a 500. Nothing the run did is hidden — any tool
                # outcomes so far are still in `activity`.
                logger.warning("agent_llm_unavailable", run_id=str(run_id), retryable=exc.retryable)
                status, error_code, answer = RunStatus.FAILED, "llm_unavailable", _BUSY_ANSWER
            except Exception:
                await self._store.finish_run(tenant_id, run_id, status=RunStatus.FAILED.value, error_code="internal")
                self._metrics.agent_runs.add(1, {"profile": profile.name, "status": RunStatus.FAILED.value})
                raise

            actions = await self._action_cards(tenant_id, pending_ids)
            response = AgentChatResponse(
                conversation_id=conversation_id,
                run_id=run_id,
                answer=answer,
                status=status,
                citations=list(citations.values()),
                actions=actions,
                activity=activity,
            )
            await self._store.store_message(
                tenant_id,
                conversation_id,
                Role.ASSISTANT,
                answer,
                run_id,
                meta=response.model_dump(mode="json", include={"citations", "actions", "activity", "status"}),
            )
            await self._store.record_steps(tenant_id, run.steps if run else [])
            await self._store.finish_run(
                tenant_id,
                run_id,
                status=status.value,
                error_code=error_code,
                models_used=models_used,
                iterations=budget.iterations,
                tool_calls=budget.tool_calls,
                input_tokens=budget.input_tokens,
                output_tokens=budget.output_tokens,
                cached_tokens=budget.cached_tokens,
                cost_usd_micros=budget.cost_usd_micros,
                response=response.model_dump(mode="json"),
            )

            span.set_attribute("agent.status", status.value)
            span.set_attribute("agent.iterations", budget.iterations)
            span.set_attribute("agent.cost_usd_micros", budget.cost_usd_micros)
            self._metrics.agent_runs.add(1, {"profile": profile.name, "status": status.value})
            self._metrics.agent_iterations.record(budget.iterations, {"profile": profile.name})
            self._metrics.agent_cost_usd_micros.add(budget.cost_usd_micros, {"profile": profile.name})
            logger.info(
                "agent_run_finished",
                run_id=str(run_id),
                status=status.value,
                iterations=budget.iterations,
                tool_calls=budget.tool_calls,
                input_tokens=budget.input_tokens,
                output_tokens=budget.output_tokens,
                cost_usd_micros=budget.cost_usd_micros,
            )
            return response

    async def _generate(
        self,
        profile: AgentProfile,
        messages: list[LLMMessage],
        tools: list[ToolDefinition],
        run: RunContext,
        models_used: list[str],
        *,
        escalate: bool = False,
        system_suffix: str | None = None,
    ) -> LLMResponse:
        primary = self._router.primary(profile.model_tier, escalate=escalate)
        try:
            return await self._call_model(primary, profile, messages, tools, run, models_used, system_suffix)
        except LLMProviderError as exc:
            fallback = self._router.fallback_for(primary)
            if not exc.retryable or fallback is None:
                raise
            logger.info("llm_fallback", primary=primary, fallback=fallback)
            return await self._call_model(fallback, profile, messages, tools, run, models_used, system_suffix)

    async def _call_model(
        self,
        model: str,
        profile: AgentProfile,
        messages: list[LLMMessage],
        tools: list[ToolDefinition],
        run: RunContext,
        models_used: list[str],
        system_suffix: str | None,
    ) -> LLMResponse:
        # Per-store cap first, then the platform-wide one. A free-tier vendor
        # quota is shared by every tenant: the global cap stops the platform
        # going over it, the per-store cap stops one busy store (many shoppers
        # at once) using all of it and leaving every other store "busy".
        # Checked in that order so a store already over its own cap never
        # takes a global slot. Both fail open if Redis is down — the vendor's
        # own 429 is the backstop, handled like any other retryable error.
        if self._llm_tenant_rpm > 0 and not await self._rate_limiter.check(
            _TENANT_LLM_KEY.format(tenant_id=run.tenant_id), self._llm_tenant_rpm, 60
        ):
            raise LLMProviderError("Store LLM rate limit reached", retryable=False)
        if self._llm_global_rpm > 0 and not await self._rate_limiter.check(_GLOBAL_LLM_KEY, self._llm_global_rpm, 60):
            raise LLMProviderError("Platform LLM rate limit reached", retryable=False)

        system_prompt = profile.system_prompt + (f"\n\n{system_suffix}" if system_suffix else "")
        with tracer.start_as_current_span("llm.generate") as span:
            span.set_attribute("llm.model", model)
            start = time.monotonic()
            try:
                resp = await self._llm.generate(
                    LLMRequest(
                        model=model,
                        messages=messages,
                        system_prompt=system_prompt,
                        max_tokens=profile.limits.max_output_tokens,
                        tools=tools,
                    )
                )
            except LLMProviderError:
                self._metrics.errors.add(1, {"type": "llm"})
                raise
            latency_ms = int((time.monotonic() - start) * 1000)
            span.set_attribute("llm.input_tokens", resp.prompt_tokens)
            span.set_attribute("llm.output_tokens", resp.completion_tokens)
            span.set_attribute("llm.stop_reason", resp.stop_reason.value)

        run.budget.record_llm(resp, self._pricing)
        if model not in models_used:
            models_used.append(model)
        self._metrics.llm_latency.record(latency_ms, {"model": model})
        self._metrics.llm_tokens.add(resp.prompt_tokens, {"kind": "prompt", "model": model})
        self._metrics.llm_tokens.add(resp.completion_tokens, {"kind": "completion", "model": model})
        self._metrics.llm_tokens.add(resp.cached_tokens, {"kind": "cached", "model": model})
        run.steps.append(
            AgentStepRow(
                tenant_id=run.tenant_id,
                run_id=run.run_id,
                seq=run.next_seq(),
                kind="llm",
                model=model,
                outcome=resp.stop_reason.value,
                latency_ms=latency_ms,
                input_tokens=resp.prompt_tokens,
                output_tokens=resp.completion_tokens,
            )
        )
        return resp

    async def _finalize(
        self,
        profile: AgentProfile,
        messages: list[LLMMessage],
        tools: RunTools,
        run: RunContext,
        models_used: list[str],
    ) -> str:
        """One last tool-less answer after a run was cut short. Any tool calls it still makes are ignored."""
        if run.budget.remaining_s() < 3.0:
            return "I couldn't finish that in time. Please try a simpler request."
        try:
            # Tool definitions stay attached (some vendors reject a history
            # with tool calls but no tools); the instruction says not to use
            # them, and any calls returned are dropped, never executed.
            resp = await self._generate(
                profile, messages, tools.definitions(), run, models_used, system_suffix=FINALIZE_INSTRUCTION
            )
        except LLMProviderError:
            return _BUSY_ANSWER
        return resp.content or "I couldn't finish that. Please try a simpler request."

    async def _action_cards(self, tenant_id: UUID, pending_ids: list[UUID]) -> list[ActionCard]:
        cards = []
        for action_id in pending_ids:
            row = await self._store.get_pending_action(tenant_id, action_id)
            if row is not None:
                cards.append(ActionCard.model_validate(row.card))
        return cards
