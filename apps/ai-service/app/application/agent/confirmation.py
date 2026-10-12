"""
The human-confirmation gate for WRITE_CONFIRM tools.

propose(): instead of running the tool, validate that the target exists,
build an ActionCard from the validated arguments plus a FRESH read of the
current values (never from the model's prose), and store the exact
arguments as a pending action. The model is told the change awaits
confirmation; it can't confirm it — only a POST from the user's own browser
session can.

confirm(): moves the action pending -> executing in one conditional UPDATE
(a double-click runs it once), runs the STORED arguments through the same
executor path as any allowed call (the model is not consulted again), then
records the real outcome. The status shown afterwards comes from core-api's
answer, not from any text the model wrote.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.application.agent.profiles import profile_for
from app.application.agent.store import AgentStore
from app.application.agent.tool_executor import ToolExecutor, args_hash
from app.application.agent.tool_registry import RunTools, ToolRegistry
from app.domain.errors import PendingActionError, PendingActionNotFound
from app.domain.interfaces.tool_provider import ActorContext, ToolOutcome, ToolStatus
from app.domain.models.agent import ActionCard, ActionField, ActionResultResponse, ActionStatus
from app.domain.models.chat import Role
from app.domain.tools.spec import ToolSpec
from app.infrastructure.persistence.models import AgentPendingActionRow
from app.observability.logging import get_logger

logger = get_logger(__name__)

PENDING_ACTION_TTL = timedelta(minutes=10)

_OUTCOME_TO_STATUS = {
    ToolStatus.SUCCEEDED: ActionStatus.SUCCEEDED,
    ToolStatus.FAILED: ActionStatus.FAILED,
    ToolStatus.REJECTED: ActionStatus.FAILED,
    ToolStatus.UNKNOWN: ActionStatus.UNKNOWN,
}


def format_aed(cents: int | None) -> str | None:
    return None if cents is None else f"AED {cents / 100:,.2f}"


def _fmt(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "Active" if value else "Inactive"
    return str(value)


async def _describe(spec: ToolSpec, args: dict, tools: RunTools) -> tuple[str, list[ActionField]] | ToolOutcome:
    """Title + before/after fields for a proposed change, or a REJECTED outcome if the target doesn't exist."""
    current = await tools.session_for(spec).call("get_product", {"product_id": args["product_id"]}, 4.0)
    if current.status is not ToolStatus.SUCCEEDED or not current.data:
        return ToolOutcome(
            tool_name=spec.name,
            status=ToolStatus.REJECTED,
            error_code=current.error_code or "not_found",
            message="That product wasn't found, so nothing was proposed.",
        )
    product = current.data["product"]

    if spec.name == "update_product":
        fields: list[ActionField] = []
        if "name" in args:
            fields.append(ActionField(label="Name", before=product.get("name"), after=args["name"]))
        if "price_cents" in args:
            fields.append(
                ActionField(
                    label="Price", before=format_aed(product.get("price_cents")), after=format_aed(args["price_cents"])
                )
            )
        if "status" in args:
            fields.append(ActionField(label="Status", before=_fmt(product.get("status")), after=args["status"]))
        if "is_active" in args:
            fields.append(
                ActionField(label="Visibility", before=_fmt(product.get("is_active")), after=_fmt(args["is_active"]))
            )
        return f"Update “{product.get('name')}”", fields

    if spec.name == "set_inventory_quantity":
        return f"Set stock for “{product.get('name')}”", [ActionField(label="Stock", after=str(args["quantity"]))]

    # A new WRITE_CONFIRM tool must add its own description here; until it
    # does, it can't be proposed (fail closed, not a generic card).
    return ToolOutcome(
        tool_name=spec.name, status=ToolStatus.REJECTED, error_code="not_confirmable", message="Not available."
    )


class ConfirmationService:
    def __init__(self, store: AgentStore, registry: ToolRegistry, executor: ToolExecutor):
        self._store = store
        self._registry = registry
        self._executor = executor

    async def propose(
        self, *, actor: ActorContext, run_id: UUID, conversation_id: UUID, spec: ToolSpec, args: dict, tools: RunTools
    ) -> ToolOutcome:
        described = await _describe(spec, args, tools)
        if isinstance(described, ToolOutcome):
            return described
        title, fields = described

        action_id = uuid4()
        expires_at = datetime.now(UTC) + PENDING_ACTION_TTL
        card = ActionCard(
            id=action_id, tool=spec.name, title=title, fields=fields, status=ActionStatus.PENDING, expires_at=expires_at
        )
        await self._store.create_pending_action(
            AgentPendingActionRow(
                id=action_id,
                tenant_id=UUID(actor.tenant_id),
                actor_id=actor.actor_id,
                actor_type=actor.actor_type,
                run_id=run_id,
                conversation_id=conversation_id,
                tool_name=spec.name,
                args=args,
                args_hash=args_hash(spec.name, args),
                card=card.model_dump(mode="json"),
                expires_at=expires_at,
            )
        )
        return ToolOutcome(
            tool_name=spec.name,
            status=ToolStatus.REQUIRES_CONFIRMATION,
            pending_action_id=action_id,
            data={"proposed_change": title, "details": [f.model_dump(exclude_none=True) for f in fields]},
            message="Waiting for the merchant to press Confirm. Nothing has changed yet.",
        )

    async def confirm(self, actor: ActorContext, action_id: UUID) -> ActionResultResponse:
        tenant_id = UUID(actor.tenant_id)
        row = await self._store.transition_action(
            tenant_id,
            action_id,
            actor_id=actor.actor_id,
            from_status="pending",
            to_status="executing",
            require_unexpired=True,
        )
        if row is None:
            await self._explain_unavailable(actor, action_id)

        profile = profile_for(actor)
        spec = self._registry.spec(profile.name, row.tool_name)
        if spec is None or row.actor_type != actor.actor_type:
            outcome = ToolOutcome(tool_name=row.tool_name, status=ToolStatus.REJECTED, error_code="not_permitted")
        else:
            async with self._registry.open(profile.name, actor) as tools:
                if tools.spec(spec.name) is None:
                    outcome = ToolOutcome(
                        tool_name=spec.name,
                        status=ToolStatus.FAILED,
                        error_code="unavailable",
                        message="Tools are unavailable right now.",
                    )
                else:
                    outcome = await self._executor.call_with_retries(spec, row.args, tools)

        status = _OUTCOME_TO_STATUS.get(outcome.status, ActionStatus.FAILED)
        message = {
            ActionStatus.SUCCEEDED: "Done — the change has been applied.",
            ActionStatus.UNKNOWN: (
                "We couldn't confirm whether the change was applied. Please check before trying again."
            ),
        }.get(status, f"The change wasn't applied{': ' + outcome.message if outcome.message else '.'}")
        card = ActionCard.model_validate(row.card).model_copy(update={"status": status, "message": message})

        await self._store.transition_action(
            tenant_id,
            action_id,
            actor_id=actor.actor_id,
            from_status="executing",
            to_status=status.value,
            outcome=outcome.model_dump(mode="json", exclude={"citations"}),
            card=card.model_dump(mode="json"),
        )
        # The outcome becomes part of the conversation, so the model sees on
        # the next turn what actually happened — written by us, not by it.
        await self._store.store_message(
            tenant_id,
            row.conversation_id,
            Role.ASSISTANT,
            f"{card.title}: {message}",
            row.run_id,
            meta={"actions": [card.model_dump(mode="json")]},
        )
        logger.info("pending_action_confirmed", action_id=str(action_id), tool=row.tool_name, status=status.value)
        return ActionResultResponse(action=card, message=message)

    async def cancel(self, actor: ActorContext, action_id: UUID) -> ActionResultResponse:
        tenant_id = UUID(actor.tenant_id)
        row = await self._store.get_pending_action(tenant_id, action_id)
        if row is None or row.actor_id != actor.actor_id:
            raise PendingActionNotFound("Action not found")
        message = "Cancelled — nothing was changed."
        card = ActionCard.model_validate(row.card).model_copy(
            update={"status": ActionStatus.CANCELLED, "message": message}
        )
        updated = await self._store.transition_action(
            tenant_id,
            action_id,
            actor_id=actor.actor_id,
            from_status="pending",
            to_status="cancelled",
            card=card.model_dump(mode="json"),
        )
        if updated is None:
            raise PendingActionError("This action can no longer be cancelled")
        return ActionResultResponse(action=card, message=message)

    async def _explain_unavailable(self, actor: ActorContext, action_id: UUID) -> None:
        tenant_id = UUID(actor.tenant_id)
        row = await self._store.get_pending_action(tenant_id, action_id)
        if row is None or row.actor_id != actor.actor_id:
            raise PendingActionNotFound("Action not found")
        if row.status == "pending":
            # Still pending but the conditional update refused it: expired.
            card = ActionCard.model_validate(row.card).model_copy(
                update={
                    "status": ActionStatus.EXPIRED,
                    "message": "This proposal expired. Ask again to get a fresh one.",
                }
            )
            await self._store.transition_action(
                tenant_id,
                action_id,
                actor_id=actor.actor_id,
                from_status="pending",
                to_status="expired",
                card=card.model_dump(mode="json"),
            )
            raise PendingActionError("This proposal has expired")
        raise PendingActionError(f"This action is already {row.status}")
