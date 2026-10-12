"""
Whether a validated tool call may run, must wait for confirmation, or is
refused. Decided by code from the tool's spec, the verified actor and the
run's budget — never by the model. This is ai-service's gate; core-api
re-checks permissions and tenancy on every call regardless (its guards and
RLS are the source of truth), so a bug here can make the agent refuse too
much, but not let it do more than the user could.
"""

from dataclasses import dataclass
from enum import Enum

from app.application.agent.budget import RunBudget
from app.domain.interfaces.tool_provider import ActorContext
from app.domain.tools.spec import ToolSpec

_PROFILE_ACTOR = {"store_copilot": "staff", "shopper_assistant": "customer"}
_STAFF_ROLES = frozenset({"owner", "staff"})


class Decision(str, Enum):
    ALLOW = "allow"
    CONFIRM = "confirm"
    DENY = "deny"


@dataclass(frozen=True)
class PolicyResult:
    decision: Decision
    reason: str | None = None


class PolicyEngine:
    def decide(self, spec: ToolSpec, actor: ActorContext, budget: RunBudget) -> PolicyResult:
        # Defence in depth: the registry only ever offers a profile's own
        # tools, but a spec for the other surface must never run here.
        if _PROFILE_ACTOR[spec.profile] != actor.actor_type:
            return PolicyResult(Decision.DENY, "not_permitted")
        if actor.actor_type == "staff" and actor.role not in _STAFF_ROLES:
            return PolicyResult(Decision.DENY, "not_permitted")

        if budget.tool_calls >= budget.limits.max_tool_calls:
            return PolicyResult(Decision.DENY, "tool_budget_exhausted")
        if budget.calls_per_tool[spec.name] >= spec.max_calls_per_run:
            return PolicyResult(Decision.DENY, "tool_call_limit")
        if spec.mutating and budget.mutations >= budget.limits.max_mutations:
            return PolicyResult(Decision.DENY, "mutation_limit")

        if spec.requires_confirmation:
            return PolicyResult(Decision.CONFIRM)
        return PolicyResult(Decision.ALLOW)
