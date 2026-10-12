"""
Postgres access for the agent: conversations, the run lock, run/step audit
rows, history, and pending actions. Every query runs inside
Db.tenant_context(), so RLS scopes it to the actor's tenant whatever the
WHERE clause says.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import and_, func, or_, select, update

from app.domain.models.chat import Role
from app.infrastructure.persistence.models import (
    AgentPendingActionRow,
    AgentRunRow,
    AgentStepRow,
    ConversationRow,
    MessageRow,
)
from app.infrastructure.persistence.postgres import Db


def _now() -> datetime:
    return datetime.now(UTC)


class AgentStore:
    def __init__(self, db: Db):
        self._db = db

    # --- conversations / lock -------------------------------------------

    async def get_or_create_conversation(self, tenant_id: UUID, actor_id: str, conversation_id: UUID | None) -> UUID:
        async with self._db.tenant_context(str(tenant_id)) as session:
            if conversation_id is not None:
                # actor_id match: one staff member can't continue another's
                # conversation, a shopper can't continue anyone else's. An
                # unknown/foreign id silently starts a new conversation.
                existing = await session.scalar(
                    select(ConversationRow.id).where(
                        ConversationRow.id == conversation_id, ConversationRow.actor_id == actor_id
                    )
                )
                if existing is not None:
                    return existing
            row = ConversationRow(id=uuid4(), tenant_id=tenant_id, actor_id=actor_id)
            session.add(row)
            return row.id

    async def acquire_lock(self, tenant_id: UUID, conversation_id: UUID, run_id: UUID, ttl_s: float) -> bool:
        async with self._db.tenant_context(str(tenant_id)) as session:
            result = await session.execute(
                update(ConversationRow)
                .where(
                    ConversationRow.id == conversation_id,
                    or_(ConversationRow.active_run_id.is_(None), ConversationRow.locked_until < func.now()),
                )
                .values(active_run_id=run_id, locked_until=_now() + timedelta(seconds=ttl_s))
                .returning(ConversationRow.id)
            )
            return result.first() is not None

    async def release_lock(self, tenant_id: UUID, conversation_id: UUID, run_id: UUID) -> None:
        async with self._db.tenant_context(str(tenant_id)) as session:
            await session.execute(
                update(ConversationRow)
                .where(ConversationRow.id == conversation_id, ConversationRow.active_run_id == run_id)
                .values(active_run_id=None, locked_until=None, updated_at=func.now())
            )

    # --- runs / steps ---------------------------------------------------

    async def find_response_for_client_message(
        self, tenant_id: UUID, conversation_id: UUID, client_message_id: UUID
    ) -> dict | None:
        async with self._db.tenant_context(str(tenant_id)) as session:
            return await session.scalar(
                select(AgentRunRow.response).where(
                    AgentRunRow.conversation_id == conversation_id,
                    AgentRunRow.client_message_id == client_message_id,
                    AgentRunRow.response.is_not(None),
                )
            )

    async def runs_since(self, tenant_id: UUID, since: datetime) -> int:
        async with self._db.tenant_context(str(tenant_id)) as session:
            return await session.scalar(
                select(func.count()).select_from(AgentRunRow).where(AgentRunRow.started_at >= since)
            )

    async def create_run(self, row: AgentRunRow) -> None:
        async with self._db.tenant_context(str(row.tenant_id)) as session:
            session.add(row)

    async def finish_run(self, tenant_id: UUID, run_id: UUID, **values) -> None:
        async with self._db.tenant_context(str(tenant_id)) as session:
            await session.execute(
                update(AgentRunRow).where(AgentRunRow.id == run_id).values(ended_at=func.now(), **values)
            )

    async def record_steps(self, tenant_id: UUID, steps: list[AgentStepRow]) -> None:
        if not steps:
            return
        async with self._db.tenant_context(str(tenant_id)) as session:
            session.add_all(steps)

    # --- messages -------------------------------------------------------

    async def history(self, tenant_id: UUID, conversation_id: UUID, limit: int) -> list[tuple[Role, str]]:
        """The last `limit` user/assistant turns, oldest first. Tool calls and results are never replayed."""
        async with self._db.tenant_context(str(tenant_id)) as session:
            rows = (
                await session.execute(
                    select(MessageRow.role, MessageRow.content)
                    .where(
                        MessageRow.conversation_id == conversation_id,
                        MessageRow.role.in_([Role.USER.value, Role.ASSISTANT.value]),
                    )
                    .order_by(MessageRow.created_at.desc())
                    .limit(limit)
                )
            ).all()
        return [(Role(r.role), r.content) for r in reversed(rows)]

    async def store_message(
        self,
        tenant_id: UUID,
        conversation_id: UUID,
        role: Role,
        content: str,
        run_id: UUID | None,
        meta: dict | None = None,
    ) -> None:
        async with self._db.tenant_context(str(tenant_id)) as session:
            session.add(
                MessageRow(
                    id=uuid4(),
                    conversation_id=conversation_id,
                    tenant_id=tenant_id,
                    role=role.value,
                    content=content,
                    run_id=run_id,
                    meta=meta or {},
                )
            )

    # --- pending actions ------------------------------------------------

    async def create_pending_action(self, row: AgentPendingActionRow) -> None:
        async with self._db.tenant_context(str(row.tenant_id)) as session:
            session.add(row)

    async def get_pending_action(self, tenant_id: UUID, action_id: UUID) -> AgentPendingActionRow | None:
        async with self._db.tenant_context(str(tenant_id)) as session:
            return await session.get(AgentPendingActionRow, action_id)

    async def transition_action(
        self,
        tenant_id: UUID,
        action_id: UUID,
        *,
        actor_id: str,
        from_status: str,
        to_status: str,
        require_unexpired: bool = False,
        outcome: dict | None = None,
        card: dict | None = None,
    ) -> AgentPendingActionRow | None:
        """
        One conditional UPDATE: succeeds only if the row is still in
        `from_status` and belongs to this actor. Two concurrent confirms
        race on the same row; exactly one gets it back.
        """
        conditions = [
            AgentPendingActionRow.id == action_id,
            AgentPendingActionRow.actor_id == actor_id,
            AgentPendingActionRow.status == from_status,
        ]
        if require_unexpired:
            conditions.append(AgentPendingActionRow.expires_at > func.now())
        values: dict = {"status": to_status, "updated_at": func.now()}
        if outcome is not None:
            values["outcome"] = outcome
        if card is not None:
            values["card"] = card
        async with self._db.tenant_context(str(tenant_id)) as session:
            result = await session.execute(
                update(AgentPendingActionRow).where(and_(*conditions)).values(**values).returning(AgentPendingActionRow)
            )
            return result.scalar_one_or_none()
