import uuid

import pytest

from app.application.agent.budget import RunBudget
from app.application.agent.policy import PolicyEngine
from app.application.agent.profiles import SHOPPER_ASSISTANT, STORE_COPILOT
from app.application.agent.tool_executor import RunContext, ToolExecutor, cap_result
from app.application.agent.tool_registry import ToolRegistry
from app.domain.interfaces.tool_provider import ActorContext, ToolOutcome, ToolStatus
from app.domain.tools.catalog import CATALOG
from app.observability.metrics import Metrics
from tests.agent_support import FakeToolProvider, call, failing

PRODUCT = "6f1c1c1e-6b8a-4d4e-9c39-5b6a0f8e2a11"
STAFF = ActorContext(tenant_id=str(uuid.uuid4()), actor_id="u1", actor_type="staff", role="owner")
CUSTOMER = ActorContext(tenant_id=str(uuid.uuid4()), actor_id="c1", actor_type="customer")


async def _run(actor, calls, handlers=None, proposals=None):
    profile = STORE_COPILOT if actor.actor_type == "staff" else SHOPPER_ASSISTANT
    provider = FakeToolProvider("mcp", handlers)
    registry = ToolRegistry(CATALOG, {"mcp": provider, "local": FakeToolProvider("local")})
    executor = ToolExecutor(PolicyEngine(), Metrics("test"))

    async def propose(spec, args, tools):
        (proposals if proposals is not None else []).append((spec.name, args))
        return ToolOutcome(tool_name=spec.name, status=ToolStatus.REQUIRES_CONFIRMATION, pending_action_id=uuid.uuid4())

    async with registry.open(profile.name, actor) as tools:
        run = RunContext(
            run_id=uuid.uuid4(),
            tenant_id=uuid.UUID(actor.tenant_id),
            actor=actor,
            tools=tools,
            budget=RunBudget(profile.limits),
            propose=propose,
        )
        outcomes = await executor.execute_batch(calls, run)
    return outcomes, provider, run


@pytest.mark.asyncio
async def test_unknown_tool_is_rejected_without_calling_anything():
    outcomes, provider, _ = await _run(CUSTOMER, [call("get_customer", customer_id=PRODUCT)])
    assert outcomes[0].status is ToolStatus.REJECTED
    assert outcomes[0].error_code == "unknown_tool"
    assert provider.calls == []


@pytest.mark.asyncio
async def test_invalid_arguments_are_rejected_with_reasons():
    outcomes, provider, run = await _run(STAFF, [call("get_order", order_id="not-a-uuid")])
    assert outcomes[0].status is ToolStatus.REJECTED
    assert outcomes[0].error_code == "invalid_arguments"
    assert "order_id" in outcomes[0].message
    assert run.validation_failures == 1
    assert provider.calls == []


@pytest.mark.asyncio
async def test_smuggled_tenant_argument_is_rejected():
    outcomes, provider, _ = await _run(STAFF, [call("get_order", order_id=PRODUCT, tenant_id="other")])
    assert outcomes[0].error_code == "invalid_arguments"
    assert provider.calls == []


@pytest.mark.asyncio
async def test_confirm_tier_goes_to_the_confirmation_gate_not_the_tool():
    proposals: list = []
    outcomes, provider, _ = await _run(
        STAFF, [call("update_product", product_id=PRODUCT, price_cents=4900)], proposals=proposals
    )
    assert outcomes[0].status is ToolStatus.REQUIRES_CONFIRMATION
    assert proposals == [("update_product", {"product_id": PRODUCT, "price_cents": 4900})]
    assert provider.calls == []


@pytest.mark.asyncio
async def test_reads_run_and_only_one_mutation_per_turn():
    calls = [
        call("get_product", "a", product_id=PRODUCT),
        call("set_cart_item_quantity", "b", product_id=PRODUCT, quantity=2),
        call("set_cart_item_quantity", "c", product_id=PRODUCT, quantity=3),
    ]
    outcomes, provider, _ = await _run(CUSTOMER, calls)
    assert [o.status for o in outcomes] == [ToolStatus.SUCCEEDED, ToolStatus.SUCCEEDED, ToolStatus.REJECTED]
    assert outcomes[2].error_code == "one_action_at_a_time"
    assert [c[0] for c in provider.calls].count("set_cart_item_quantity") == 1


@pytest.mark.asyncio
async def test_lost_mutation_response_is_unknown_never_success_or_failure():
    handlers = {"set_cart_item_quantity": lambda args: failing("timeout")}
    outcomes, provider, _ = await _run(
        CUSTOMER, [call("set_cart_item_quantity", product_id=PRODUCT, quantity=2)], handlers
    )
    assert outcomes[0].status is ToolStatus.UNKNOWN
    # Retried once: safe, because the tool sets an absolute quantity.
    assert len(provider.calls) == 2


@pytest.mark.asyncio
async def test_unreachable_server_is_a_definite_failure_for_a_mutation():
    handlers = {"set_cart_item_quantity": lambda args: failing("unavailable")}
    outcomes, _, _ = await _run(CUSTOMER, [call("set_cart_item_quantity", product_id=PRODUCT, quantity=2)], handlers)
    assert outcomes[0].status is ToolStatus.FAILED


@pytest.mark.asyncio
async def test_server_rejection_is_not_retried():
    handlers = {"get_order": lambda args: failing("not_found")}
    outcomes, provider, _ = await _run(STAFF, [call("get_order", order_id=PRODUCT)], handlers)
    assert outcomes[0].status is ToolStatus.FAILED
    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_read_transport_errors_are_retried():
    attempts = iter([failing("transport"), {"order": {"id": PRODUCT}}])
    outcomes, provider, _ = await _run(
        STAFF, [call("get_order", order_id=PRODUCT)], {"get_order": lambda a: next(attempts)}
    )
    assert outcomes[0].status is ToolStatus.SUCCEEDED
    assert len(provider.calls) == 2


@pytest.mark.asyncio
async def test_repeated_call_returns_cached_then_flags_a_loop():
    profile = STORE_COPILOT
    provider = FakeToolProvider("mcp")
    registry = ToolRegistry(CATALOG, {"mcp": provider, "local": FakeToolProvider("local")})
    executor = ToolExecutor(PolicyEngine(), Metrics("test"))
    async with registry.open(profile.name, STAFF) as tools:
        run = RunContext(
            run_id=uuid.uuid4(),
            tenant_id=uuid.UUID(STAFF.tenant_id),
            actor=STAFF,
            tools=tools,
            budget=RunBudget(profile.limits),
            propose=None,  # type: ignore[arg-type]
        )
        same = call("get_order", order_id=PRODUCT)
        first = await executor.execute_batch([same], run)
        second = await executor.execute_batch([same], run)
        third = await executor.execute_batch([same], run)
    assert first[0].status is ToolStatus.SUCCEEDED
    assert second[0].status is ToolStatus.SUCCEEDED and "Duplicate" in second[0].message
    assert third[0].error_code == "repeated_call"
    assert run.loop_detected
    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_tool_hidden_when_server_schema_drifts():
    served = {"get_order": {"properties": {"id": {}}, "required": ["id"]}}
    registry = ToolRegistry(
        CATALOG, {"mcp": FakeToolProvider("mcp", served=served), "local": FakeToolProvider("local")}
    )
    async with registry.open("store_copilot", STAFF) as tools:
        assert tools.spec("get_order") is None
        assert tools.hidden["get_order"] == "schema_mismatch"
        assert tools.hidden["search_products"] == "not_served"
        assert tools.spec("knowledge_search") is not None


def test_cap_result_trims_lists_and_says_so():
    data = {"total": 500, "products": [{"id": i, "name": "x" * 50} for i in range(200)]}
    capped, truncated = cap_result(data, 2000)
    assert truncated
    assert 0 < len(capped["products"]) < 200
    assert capped["total"] == 500
