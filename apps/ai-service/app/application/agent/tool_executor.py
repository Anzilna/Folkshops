"""
Turns the model's proposed tool calls into ToolOutcomes. For each call:

  unknown/hidden tool?  -> REJECTED
  arguments valid?      -> Pydantic, extra keys forbidden; else REJECTED with the errors (the model may fix them)
  repeated call?        -> first repeat returns the earlier outcome, second ends the run (loop)
  policy                -> DENY -> REJECTED, CONFIRM -> pending action (REQUIRES_CONFIRMATION), ALLOW -> run it
  run                   -> with a timeout; reads retry on transport errors;
                           a mutation whose response was lost is retried once (every mutating
                           tool sets an absolute value, so a retry can't double-apply) and is
                           UNKNOWN — never success, never failure — if that fails too
  result                -> size-capped (lists trimmed, `truncated` set)

Parallelism: a batch of read calls runs concurrently; at most ONE mutation
runs per model turn, after the reads, and any further mutations in the same
turn are rejected so the model re-issues them one at a time.
"""

import asyncio
import hashlib
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from uuid import UUID

from pydantic import ValidationError

from app.application.agent.budget import RunBudget
from app.application.agent.policy import Decision, PolicyEngine
from app.application.agent.tool_registry import RunTools
from app.domain.interfaces.llm import ToolCall
from app.domain.interfaces.tool_provider import TRANSPORT_ERROR_CODES, ActorContext, ToolOutcome, ToolStatus
from app.domain.tools.spec import ToolSpec
from app.infrastructure.persistence.models import AgentStepRow
from app.observability.logging import get_logger
from app.observability.metrics import Metrics
from app.observability.tracing import get_tracer

logger = get_logger(__name__)
tracer = get_tracer(__name__)

_RETRY_BACKOFF_S = 0.3

# Called for a CONFIRM decision: persists a pending action and returns the
# REQUIRES_CONFIRMATION outcome (application/agent/confirmation.py).
ProposeFn = Callable[[ToolSpec, dict, RunTools], Awaitable[ToolOutcome]]


def canonical_args(args: dict) -> str:
    return json.dumps(args, sort_keys=True, separators=(",", ":"), default=str)


def args_hash(name: str, args: dict) -> str:
    return hashlib.sha256(f"{name}:{canonical_args(args)}".encode()).hexdigest()


def redact(spec: ToolSpec, args: dict) -> dict:
    return {k: ("[redacted]" if k in spec.sensitive_args else v) for k, v in args.items()}


def cap_result(data: dict, max_bytes: int) -> tuple[dict, bool]:
    """Trim the longest list in `data` until it serializes under max_bytes. Never silently: returns truncated=True."""
    if len(json.dumps(data, default=str)) <= max_bytes:
        return data, False
    data = json.loads(json.dumps(data, default=str))
    lists = [(k, v) for k, v in data.items() if isinstance(v, list)]
    if lists:
        key, items = max(lists, key=lambda kv: len(kv[1]))
        while items and len(json.dumps(data)) > max_bytes:
            items.pop()
        if len(json.dumps(data)) <= max_bytes:
            return data, True
    return {"note": "Result too large to show; narrow the request."}, True


@dataclass
class RunContext:
    """Everything the executor needs about the run in progress."""

    run_id: UUID
    tenant_id: UUID
    actor: ActorContext
    tools: RunTools
    budget: RunBudget
    propose: ProposeFn
    seen: dict[str, tuple[int, ToolOutcome]] = field(default_factory=dict)
    steps: list[AgentStepRow] = field(default_factory=list)
    step_seq: int = 0
    validation_failures: int = 0
    loop_detected: bool = False

    def next_seq(self) -> int:
        self.step_seq += 1
        return self.step_seq


class ToolExecutor:
    def __init__(self, policy: PolicyEngine, metrics: Metrics):
        self._policy = policy
        self._metrics = metrics

    async def execute_batch(self, calls: list[ToolCall], run: RunContext) -> list[ToolOutcome]:
        prepared = [self._prepare(call, run) for call in calls]

        outcomes: list[ToolOutcome | None] = [p if isinstance(p, ToolOutcome) else None for p in prepared]
        reads = [(i, p) for i, p in enumerate(prepared) if isinstance(p, _Ready) and not p.spec.mutating]
        writes = [(i, p) for i, p in enumerate(prepared) if isinstance(p, _Ready) and p.spec.mutating]

        if reads:
            results = await asyncio.gather(*(self._run_ready(p, run) for _, p in reads))
            for (i, _), outcome in zip(reads, results, strict=True):
                outcomes[i] = outcome
        for n, (i, p) in enumerate(writes):
            if n == 0:
                outcomes[i] = await self._run_ready(p, run)
            else:
                outcomes[i] = self._reject(p.spec.name, "one_action_at_a_time", "Make one change at a time.", run, p)
        return [o for o in outcomes if o is not None]

    # --- preparation: validation, loop detection (no I/O) ------------------

    def _prepare(self, call: ToolCall, run: RunContext) -> "ToolOutcome | _Ready":
        spec = run.tools.spec(call.name)
        if spec is None:
            return self._reject(call.name, "unknown_tool", "That tool isn't available.", run)
        try:
            validated = spec.args_model.model_validate(call.arguments)
        except ValidationError as exc:
            run.validation_failures += 1
            errors = [f"{'.'.join(str(p) for p in e['loc']) or 'arguments'}: {e['msg']}" for e in exc.errors()][:5]
            return self._reject(call.name, "invalid_arguments", "; ".join(errors), run)

        args = validated.model_dump(mode="json", exclude_none=True)
        key = args_hash(spec.name, args)
        if key in run.seen:
            count, previous = run.seen[key]
            run.seen[key] = (count + 1, previous)
            if count >= 2:
                run.loop_detected = True
                return self._reject(spec.name, "repeated_call", "This exact call was already made twice.", run)
            return previous.model_copy(update={"message": "Duplicate call; the result is unchanged from before."})
        return _Ready(spec=spec, args=args, key=key)

    # --- execution --------------------------------------------------------

    async def _run_ready(self, ready: "_Ready", run: RunContext) -> ToolOutcome:
        spec, args = ready.spec, ready.args
        decision = self._policy.decide(spec, run.actor, run.budget)
        run.budget.tool_calls += 1
        run.budget.calls_per_tool[spec.name] += 1

        with tracer.start_as_current_span("tool.execute") as span:
            span.set_attribute("tool.name", spec.name)
            span.set_attribute("tool.tier", spec.tier.value)
            span.set_attribute("policy.decision", decision.decision.value)
            start = time.monotonic()

            if decision.decision is Decision.DENY:
                outcome = ToolOutcome(
                    tool_name=spec.name,
                    status=ToolStatus.REJECTED,
                    error_code=decision.reason,
                    message="Not allowed right now.",
                )
            elif decision.decision is Decision.CONFIRM:
                run.budget.mutations += 1
                outcome = await run.propose(spec, args, run.tools)
            else:
                if spec.mutating:
                    run.budget.mutations += 1
                outcome = await self.call_with_retries(spec, args, run.tools, deadline_s=run.budget.remaining_s())

            latency_ms = int((time.monotonic() - start) * 1000)
            span.set_attribute("tool.outcome", outcome.status.value)

        run.seen[ready.key] = (1, outcome)
        self._metrics.tool_latency.record(latency_ms, {"tool": spec.name})
        self._metrics.agent_tool_calls.add(1, {"tool": spec.name, "outcome": outcome.status.value})
        run.steps.append(
            AgentStepRow(
                tenant_id=run.tenant_id,
                run_id=run.run_id,
                seq=run.next_seq(),
                kind="tool",
                tool_name=spec.name,
                args_redacted=redact(spec, args),
                args_hash=ready.key,
                policy_decision=decision.decision.value,
                outcome=outcome.status.value,
                error_code=outcome.error_code,
                latency_ms=latency_ms,
                result_bytes=len(json.dumps(outcome.data, default=str)) if outcome.data is not None else 0,
            )
        )
        return outcome

    async def call_with_retries(
        self, spec: ToolSpec, args: dict, tools: RunTools, *, deadline_s: float | None = None
    ) -> ToolOutcome:
        """Runs an ALLOWED call (or a human-confirmed one). Shared with the confirmation endpoint."""
        session = tools.session_for(spec)
        attempts = 1 + (1 if spec.mutating else spec.max_retries)
        outcome: ToolOutcome | None = None
        for attempt in range(attempts):
            timeout = spec.timeout_s if deadline_s is None else max(min(spec.timeout_s, deadline_s), 1.0)
            outcome = await session.call(spec.name, args, timeout)
            retryable = outcome.status is ToolStatus.FAILED and outcome.error_code in TRANSPORT_ERROR_CODES
            if not retryable or attempt == attempts - 1:
                break
            await asyncio.sleep(_RETRY_BACKOFF_S * (attempt + 1))
        assert outcome is not None

        if spec.mutating and outcome.status is ToolStatus.FAILED:
            # A mutation that might have reached core-api: "timeout"/"transport"
            # mean the request may have been applied before the response was
            # lost, and "internal" means it threw after possibly writing.
            # "unavailable" (connection refused) never reached it.
            if outcome.error_code in {"timeout", "transport", "internal", "bad_response"}:
                outcome = outcome.model_copy(
                    update={
                        "status": ToolStatus.UNKNOWN,
                        "message": "Couldn't confirm whether this change was applied.",
                    }
                )

        if outcome.data is not None:
            data, truncated = cap_result(outcome.data, spec.result_max_bytes)
            outcome = outcome.model_copy(update={"data": data, "truncated": outcome.truncated or truncated})
        return outcome

    def _reject(
        self, name: str, code: str, message: str, run: RunContext, ready: "_Ready | None" = None
    ) -> ToolOutcome:
        run.steps.append(
            AgentStepRow(
                tenant_id=run.tenant_id,
                run_id=run.run_id,
                seq=run.next_seq(),
                kind="tool",
                tool_name=name,
                args_hash=ready.key if ready else None,
                policy_decision="deny",
                outcome=ToolStatus.REJECTED.value,
                error_code=code,
            )
        )
        self._metrics.agent_tool_calls.add(1, {"tool": name, "outcome": ToolStatus.REJECTED.value})
        return ToolOutcome(tool_name=name, status=ToolStatus.REJECTED, error_code=code, message=message)


@dataclass
class _Ready:
    spec: ToolSpec
    args: dict
    key: str
