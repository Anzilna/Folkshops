"""
The agent loop end to end against real Postgres (run/step/pending-action
rows, the conversation lock, RLS), with a scripted LLM and an in-memory
tool provider standing in for core-api's MCP server — so every assertion
is about what the loop does, not about a model's mood.
"""

import uuid

import pytest
from sqlalchemy import select

from app.application.agent.agent_service import AgentService
from app.application.agent.budget import LlmPricing
from app.application.agent.confirmation import ConfirmationService
from app.application.agent.model_router import ModelRouter
from app.application.agent.policy import PolicyEngine
from app.application.agent.store import AgentStore
from app.application.agent.tool_executor import ToolExecutor
from app.application.agent.tool_registry import ToolRegistry
from app.domain.errors import ConversationBusy, PendingActionError, PendingActionNotFound
from app.domain.interfaces.tool_provider import ActorContext
from app.domain.models.agent import ActionStatus, AgentChatRequest, RunStatus
from app.domain.tools.catalog import CATALOG
from app.infrastructure.cache.redis import RateLimiter
from app.infrastructure.persistence.models import AgentRunRow, AgentStepRow
from tests.agent_support import (
    RATE_LIMITED,
    FakeToolProvider,
    RepeatingLLM,
    ScriptedLLM,
    answer,
    call,
    failing,
    tool_turn,
)
from tests.conftest import TEST_REDIS_URL

PRODUCT = "6f1c1c1e-6b8a-4d4e-9c39-5b6a0f8e2a11"
PRODUCT_DATA = {
    "product": {"id": PRODUCT, "name": "Saffron Tea", "price_cents": 3500, "status": "active", "is_active": True}
}


def _staff(tenant_id=None) -> ActorContext:
    return ActorContext(
        tenant_id=str(tenant_id or uuid.uuid4()), actor_id=str(uuid.uuid4()), actor_type="staff", role="owner"
    )


def _customer(tenant_id=None) -> ActorContext:
    return ActorContext(tenant_id=str(tenant_id or uuid.uuid4()), actor_id=str(uuid.uuid4()), actor_type="customer")


def _build(db, metrics, llm, handlers=None, daily_runs=1000):
    store = AgentStore(db)
    mcp = FakeToolProvider("mcp", {"get_product": lambda a: PRODUCT_DATA, **(handlers or {})})
    registry = ToolRegistry(CATALOG, {"mcp": mcp, "local": FakeToolProvider("local")})
    executor = ToolExecutor(PolicyEngine(), metrics)
    confirmations = ConfirmationService(store, registry, executor)
    agent = AgentService(
        store=store,
        registry=registry,
        executor=executor,
        confirmations=confirmations,
        llm=llm,
        router=ModelRouter(fast="fast-model", standard="std-model", fallback="fallback-model"),
        pricing=LlmPricing(input_per_mtok=1.0, output_per_mtok=4.0),
        metrics=metrics,
        rate_limiter=RateLimiter.from_url(TEST_REDIS_URL),
        llm_global_rpm=0,
        tenant_daily_runs=daily_runs,
    )
    return agent, confirmations, mcp, store


async def _run_row(db, tenant_id, run_id) -> AgentRunRow:
    async with db.tenant_context(str(tenant_id)) as session:
        return await session.get(AgentRunRow, run_id)


@pytest.mark.asyncio
async def test_plain_answer_records_run_and_cost(db, metrics):
    llm = ScriptedLLM(answer("Hello!"))
    agent, _, _, _ = _build(db, metrics, llm)
    actor = _staff()
    resp = await agent.chat(actor, AgentChatRequest(message="hi"))

    assert resp.status is RunStatus.COMPLETED
    assert resp.answer == "Hello!"
    run = await _run_row(db, actor.tenant_id, resp.run_id)
    assert run.status == "completed"
    assert run.models_used == ["std-model"]  # copilot -> standard tier
    assert run.input_tokens == 100 and run.output_tokens == 20
    assert run.cost_usd_micros == 180  # 100 * $1/M + 20 * $4/M = $0.00018


@pytest.mark.asyncio
async def test_tool_result_goes_back_to_the_model_and_is_audited(db, metrics):
    llm = ScriptedLLM(tool_turn(call("get_product", product_id=PRODUCT)), answer("Saffron Tea costs AED 35.00."))
    agent, _, mcp, _ = _build(db, metrics, llm)
    actor = _customer()
    resp = await agent.chat(actor, AgentChatRequest(message="price of saffron tea?"))

    assert resp.answer == "Saffron Tea costs AED 35.00."
    assert [(a.tool, a.status) for a in resp.activity] == [("get_product", "succeeded")]
    assert mcp.calls[0][2] == actor.tenant_id  # ran under the caller's own tenant
    assert llm.requests[0].model == "fast-model"  # shopper -> fast tier
    tool_message = llm.requests[1].messages[-1]
    assert tool_message.tool_name == "get_product" and "Saffron Tea" in tool_message.content

    async with db.tenant_context(actor.tenant_id) as session:
        steps = (await session.scalars(select(AgentStepRow).where(AgentStepRow.run_id == resp.run_id))).all()
    assert sorted(s.kind for s in steps) == ["llm", "llm", "tool"]


@pytest.mark.asyncio
async def test_proposed_change_waits_for_confirmation_then_runs_exactly_once(db, metrics):
    llm = ScriptedLLM(tool_turn(call("update_product", product_id=PRODUCT, price_cents=4900)))
    agent, confirmations, mcp, _ = _build(
        db, metrics, llm, {"update_product": lambda a: {"product": {**PRODUCT_DATA["product"], "price_cents": 4900}}}
    )
    actor = _staff()
    resp = await agent.chat(actor, AgentChatRequest(message="set saffron tea to 49"))

    assert resp.status is RunStatus.AWAITING_CONFIRMATION
    card = resp.actions[0]
    assert card.status is ActionStatus.PENDING
    assert card.title == "Update “Saffron Tea”"
    assert (card.fields[0].before, card.fields[0].after) == ("AED 35.00", "AED 49.00")
    assert [c[0] for c in mcp.calls] == ["get_product"]  # read for the card; nothing written yet
    assert len(llm.requests) == 1  # no further model call once a change awaits confirmation

    result = await confirmations.confirm(actor, card.id)
    assert result.action.status is ActionStatus.SUCCEEDED
    assert [c for c in mcp.calls if c[0] == "update_product"] == [
        ("update_product", {"product_id": PRODUCT, "price_cents": 4900}, actor.tenant_id)
    ]

    with pytest.raises(PendingActionError):
        await confirmations.confirm(actor, card.id)  # a double-click doesn't run it again
    assert len([c for c in mcp.calls if c[0] == "update_product"]) == 1


@pytest.mark.asyncio
async def test_another_user_cannot_confirm_or_see_an_action(db, metrics):
    llm = ScriptedLLM(tool_turn(call("set_inventory_quantity", product_id=PRODUCT, quantity=10)))
    agent, confirmations, mcp, _ = _build(db, metrics, llm)
    owner = _staff()
    resp = await agent.chat(owner, AgentChatRequest(message="stock 10"))
    action_id = resp.actions[0].id

    colleague = _staff(owner.tenant_id)
    with pytest.raises(PendingActionNotFound):
        await confirmations.confirm(colleague, action_id)
    other_store = _staff()
    with pytest.raises(PendingActionNotFound):  # RLS: invisible from another tenant
        await confirmations.confirm(other_store.model_copy(update={"actor_id": owner.actor_id}), action_id)
    assert not [c for c in mcp.calls if c[0] == "set_inventory_quantity"]


@pytest.mark.asyncio
async def test_cancelled_action_never_runs(db, metrics):
    llm = ScriptedLLM(tool_turn(call("set_inventory_quantity", product_id=PRODUCT, quantity=10)))
    agent, confirmations, mcp, _ = _build(db, metrics, llm)
    actor = _staff()
    resp = await agent.chat(actor, AgentChatRequest(message="stock 10"))
    cancelled = await confirmations.cancel(actor, resp.actions[0].id)
    assert cancelled.action.status is ActionStatus.CANCELLED
    with pytest.raises(PendingActionError):
        await confirmations.confirm(actor, resp.actions[0].id)
    assert not [c for c in mcp.calls if c[0] == "set_inventory_quantity"]


@pytest.mark.asyncio
async def test_confirmed_change_with_lost_response_is_reported_unknown(db, metrics):
    llm = ScriptedLLM(tool_turn(call("set_inventory_quantity", product_id=PRODUCT, quantity=10)))
    agent, confirmations, _, _ = _build(db, metrics, llm, {"set_inventory_quantity": lambda a: failing("timeout")})
    actor = _staff()
    resp = await agent.chat(actor, AgentChatRequest(message="stock 10"))
    result = await confirmations.confirm(actor, resp.actions[0].id)
    assert result.action.status is ActionStatus.UNKNOWN
    assert "couldn't confirm" in result.message


@pytest.mark.asyncio
async def test_repeating_model_is_stopped_as_a_loop(db, metrics):
    llm = RepeatingLLM(tool_turn(call("get_product", product_id=PRODUCT)))
    agent, _, mcp, _ = _build(db, metrics, llm)
    resp = await agent.chat(_staff(), AgentChatRequest(message="loop"))
    assert resp.status is RunStatus.LOOP_DETECTED
    assert len(mcp.calls) == 1  # repeats were answered from the first result
    assert len(llm.requests) <= 5


@pytest.mark.asyncio
async def test_iteration_budget_stops_the_run(db, metrics):
    # Different product each turn, so it isn't a repeat — just never finishing.
    turns = [tool_turn(call("get_order", order_id=str(uuid.uuid4()))) for _ in range(10)]
    llm = ScriptedLLM(*turns, answer("partial answer"))
    agent, _, _, _ = _build(db, metrics, llm, {"get_order": lambda a: {"order": {"id": a["order_id"]}}})
    resp = await agent.chat(_staff(), AgentChatRequest(message="go"))
    assert resp.status is RunStatus.BUDGET_EXHAUSTED


@pytest.mark.asyncio
async def test_resend_with_same_client_message_id_returns_first_response(db, metrics):
    llm = ScriptedLLM(answer("first"))
    agent, _, _, _ = _build(db, metrics, llm)
    actor = _staff()
    first = await agent.chat(actor, AgentChatRequest(message="hi", client_message_id=uuid.UUID(int=1)))
    again = await agent.chat(
        actor, AgentChatRequest(message="hi", conversation_id=first.conversation_id, client_message_id=uuid.UUID(int=1))
    )
    assert again.run_id == first.run_id
    assert len(llm.requests) == 1


@pytest.mark.asyncio
async def test_conversation_runs_one_at_a_time(db, metrics):
    llm = ScriptedLLM(answer("one"))
    agent, _, _, store = _build(db, metrics, llm)
    actor = _staff()
    first = await agent.chat(actor, AgentChatRequest(message="hi"))
    assert await store.acquire_lock(uuid.UUID(actor.tenant_id), first.conversation_id, uuid.uuid4(), 60)
    with pytest.raises(ConversationBusy):
        await agent.chat(actor, AgentChatRequest(message="again", conversation_id=first.conversation_id))


@pytest.mark.asyncio
async def test_rate_limited_model_falls_back_then_answers(db, metrics):
    llm = ScriptedLLM(RATE_LIMITED, answer("from fallback"))
    agent, _, _, _ = _build(db, metrics, llm)
    resp = await agent.chat(_staff(), AgentChatRequest(message="hi"))
    assert resp.answer == "from fallback"
    assert [r.model for r in llm.requests] == ["std-model", "fallback-model"]


@pytest.mark.asyncio
async def test_vendor_down_gives_a_clear_answer_not_an_error(db, metrics):
    llm = ScriptedLLM(RATE_LIMITED, RATE_LIMITED)
    agent, _, _, _ = _build(db, metrics, llm)
    actor = _staff()
    resp = await agent.chat(actor, AgentChatRequest(message="hi"))
    assert resp.status is RunStatus.FAILED
    assert "busy" in resp.answer
    assert (await _run_row(db, actor.tenant_id, resp.run_id)).error_code == "llm_unavailable"


@pytest.mark.asyncio
async def test_history_is_replayed_but_tool_payloads_are_not(db, metrics):
    llm = ScriptedLLM(
        tool_turn(call("get_product", product_id=PRODUCT)), answer("It is AED 35.00."), answer("You're welcome")
    )
    agent, _, _, _ = _build(db, metrics, llm)
    actor = _customer()
    first = await agent.chat(actor, AgentChatRequest(message="price?"))
    await agent.chat(actor, AgentChatRequest(message="thanks", conversation_id=first.conversation_id))
    replayed = llm.requests[-1].messages
    assert [(m.role.value, m.content) for m in replayed] == [
        ("user", "price?"),
        ("assistant", "It is AED 35.00."),
        ("user", "thanks"),
    ]


@pytest.mark.asyncio
async def test_one_store_cannot_use_another_stores_llm_quota(db, metrics):
    # Per-store cap of 2 calls/min: store A's third run is refused as busy,
    # while store B, same instant, still gets answers.
    llm = RepeatingLLM(answer("ok"))
    agent, _, _, _ = _build(db, metrics, llm)
    agent._llm_tenant_rpm = 2
    store_a, store_b = _staff(), _staff()

    for _ in range(2):
        assert (await agent.chat(store_a, AgentChatRequest(message="hi"))).status is RunStatus.COMPLETED
    blocked = await agent.chat(store_a, AgentChatRequest(message="hi"))
    assert blocked.status is RunStatus.FAILED
    assert "busy" in blocked.answer

    assert (await agent.chat(store_b, AgentChatRequest(message="hi"))).status is RunStatus.COMPLETED
    assert len(llm.requests) == 3  # the blocked run never reached the model


@pytest.mark.asyncio
async def test_graph_emits_a_progress_event_per_finished_tool_call(db, metrics):
    """The streaming endpoint's source: one event per tool step, in order, before the final answer exists."""
    llm = ScriptedLLM(
        tool_turn(call("get_product", product_id=PRODUCT)),
        tool_turn(call("get_product", call_id="c2", product_id=PRODUCT)),
        answer("Done."),
    )
    agent, _, _, _ = _build(db, metrics, llm)
    events: list[dict] = []

    async def sink(event: dict) -> None:
        events.append(event)

    resp = await agent.chat(_staff(), AgentChatRequest(message="check twice"), on_event=sink)

    assert resp.answer == "Done."
    assert [(e["type"], e["tool"], e["status"]) for e in events] == [
        ("tool", "get_product", "succeeded"),
        ("tool", "get_product", "succeeded"),
    ]


@pytest.mark.asyncio
async def test_llm_failure_after_a_tool_step_still_reports_that_tool(db, metrics):
    """Partial progress isn't lost when a later graph step raises."""
    from app.domain.errors import LLMProviderError

    class FailsOnSecondCall(ScriptedLLM):
        async def generate(self, request):
            if self.requests:
                raise LLMProviderError("down", retryable=False)
            return await super().generate(request)

    llm = FailsOnSecondCall(tool_turn(call("get_product", product_id=PRODUCT)))
    agent, _, _, _ = _build(db, metrics, llm)
    resp = await agent.chat(_staff(), AgentChatRequest(message="price?"))

    assert resp.status is RunStatus.FAILED
    assert [(a.tool, a.status) for a in resp.activity] == [("get_product", "succeeded")]
