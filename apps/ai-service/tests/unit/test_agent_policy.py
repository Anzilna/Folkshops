from app.application.agent.budget import RunBudget
from app.application.agent.policy import Decision, PolicyEngine
from app.application.agent.profiles import SHOPPER_ASSISTANT, STORE_COPILOT
from app.domain.interfaces.tool_provider import ActorContext
from app.domain.tools.catalog import CATALOG

STAFF = ActorContext(tenant_id="t1", actor_id="u1", actor_type="staff", role="owner")
CUSTOMER = ActorContext(tenant_id="t1", actor_id="c1", actor_type="customer")


def spec(profile: str, name: str):
    return next(s for s in CATALOG[profile] if s.name == name)


def test_reads_are_allowed():
    result = PolicyEngine().decide(spec("store_copilot", "get_order"), STAFF, RunBudget(STORE_COPILOT.limits))
    assert result.decision is Decision.ALLOW


def test_business_mutations_need_confirmation():
    result = PolicyEngine().decide(spec("store_copilot", "update_product"), STAFF, RunBudget(STORE_COPILOT.limits))
    assert result.decision is Decision.CONFIRM


def test_cart_changes_run_without_confirmation():
    result = PolicyEngine().decide(
        spec("shopper_assistant", "set_cart_item_quantity"), CUSTOMER, RunBudget(SHOPPER_ASSISTANT.limits)
    )
    assert result.decision is Decision.ALLOW


def test_customer_can_never_run_a_staff_tool():
    result = PolicyEngine().decide(spec("store_copilot", "get_customer"), CUSTOMER, RunBudget(SHOPPER_ASSISTANT.limits))
    assert result.decision is Decision.DENY


def test_staff_token_without_a_known_role_is_denied():
    odd = STAFF.model_copy(update={"role": None})
    result = PolicyEngine().decide(spec("store_copilot", "get_order"), odd, RunBudget(STORE_COPILOT.limits))
    assert result.decision is Decision.DENY


def test_budgets_are_enforced():
    budget = RunBudget(STORE_COPILOT.limits)
    budget.tool_calls = STORE_COPILOT.limits.max_tool_calls
    assert PolicyEngine().decide(spec("store_copilot", "get_order"), STAFF, budget).reason == "tool_budget_exhausted"

    budget = RunBudget(STORE_COPILOT.limits)
    budget.calls_per_tool["update_product"] = 1
    assert PolicyEngine().decide(spec("store_copilot", "update_product"), STAFF, budget).reason == "tool_call_limit"

    budget = RunBudget(SHOPPER_ASSISTANT.limits)
    budget.mutations = SHOPPER_ASSISTANT.limits.max_mutations
    result = PolicyEngine().decide(spec("shopper_assistant", "set_cart_item_quantity"), CUSTOMER, budget)
    assert result.reason == "mutation_limit"
