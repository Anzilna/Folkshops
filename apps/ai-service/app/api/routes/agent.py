"""
The agent's HTTP surface — auth, rate limits and error mapping only; the
loop lives in application/agent/.

  POST /agent/chat                     one user message -> one bounded agent run
  POST /agent/chat/stream              the same run as Server-Sent Events (progress, then the full answer)
  POST /agent/actions/{id}/confirm     run a proposed change, exactly as proposed
  POST /agent/actions/{id}/cancel      discard it

Staff tokens get the Store Copilot, customer tokens the Shopper Assistant.
Confirm/cancel need the same actor that the action was proposed to — a
confirmation is a click from the user's own session, never something the
model or another user can produce.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import (
    get_agent_service,
    get_confirmation_service,
    get_rate_limiter,
    require_agent_access,
)
from app.application.agent.agent_service import AgentService
from app.application.agent.confirmation import ConfirmationService
from app.domain.errors import AgentBudgetExceeded, ConversationBusy, PendingActionError, PendingActionNotFound
from app.domain.interfaces.tool_provider import ActorContext
from app.domain.models.agent import ActionResultResponse, AgentChatRequest, AgentChatResponse
from app.infrastructure.cache.redis import RateLimiter
from app.observability.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/agent", tags=["agent"])

# Strong references to in-flight stream runs: asyncio only keeps weak ones.
_stream_tasks: set[asyncio.Task] = set()

_CHAT_RATE_LIMIT = 20
_ACTION_RATE_LIMIT = 30
_RATE_WINDOW_SECONDS = 60


async def _rate_limit(rate_limiter: RateLimiter, key: str, limit: int) -> None:
    if not await rate_limiter.check(key, limit, _RATE_WINDOW_SECONDS):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")


@router.post("/chat", response_model=AgentChatResponse)
async def agent_chat(
    body: AgentChatRequest,
    actor: ActorContext = Depends(require_agent_access),
    agent: AgentService = Depends(get_agent_service),
    rate_limiter: RateLimiter = Depends(get_rate_limiter),
) -> AgentChatResponse:
    await _rate_limit(rate_limiter, f"agent:{actor.tenant_id}:{actor.actor_id}", _CHAT_RATE_LIMIT)
    try:
        return await agent.chat(actor, body)
    except ConversationBusy as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc
    except AgentBudgetExceeded as exc:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=exc.message) from exc


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.post("/chat/stream")
async def agent_chat_stream(
    body: AgentChatRequest,
    actor: ActorContext = Depends(require_agent_access),
    agent: AgentService = Depends(get_agent_service),
    rate_limiter: RateLimiter = Depends(get_rate_limiter),
) -> StreamingResponse:
    """
    The same run as /agent/chat, streamed as SSE: a `tool` event as each tool
    call finishes (the browser can show "Searched your documents" live), then
    one `done` event carrying the full AgentChatResponse — identical to the
    JSON endpoint's body, so a client can always rely on `done` alone. A
    failure is an `error` event with the HTTP status it would have had.

    The run executes in its own task and the HTTP stream only reads a queue,
    so a browser that disconnects mid-run does not abort it half-way (a
    proposed change, the run record and the lock release all still complete).
    Streaming is per step, not per token: the LLMProvider seam is not
    streaming yet (docs/decisions/0018).
    """
    await _rate_limit(rate_limiter, f"agent:{actor.tenant_id}:{actor.actor_id}", _CHAT_RATE_LIMIT)
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def sink(event: dict[str, Any]) -> None:
        await queue.put(event)

    async def run() -> None:
        try:
            response = await agent.chat(actor, body, on_event=sink)
            await queue.put({"type": "done", "response": response.model_dump(mode="json")})
        except ConversationBusy as exc:
            await queue.put({"type": "error", "status": 409, "message": exc.message})
        except AgentBudgetExceeded as exc:
            await queue.put({"type": "error", "status": 429, "message": exc.message})
        except Exception:
            logger.exception("agent_stream_failed")
            await queue.put({"type": "error", "status": 500, "message": "The assistant couldn't answer that."})
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    _stream_tasks.add(task)
    task.add_done_callback(_stream_tasks.discard)

    async def events() -> AsyncIterator[str]:
        while (event := await queue.get()) is not None:
            yield _sse(event)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/actions/{action_id}/confirm", response_model=ActionResultResponse)
async def confirm_action(
    action_id: UUID,
    actor: ActorContext = Depends(require_agent_access),
    confirmations: ConfirmationService = Depends(get_confirmation_service),
    rate_limiter: RateLimiter = Depends(get_rate_limiter),
) -> ActionResultResponse:
    await _rate_limit(rate_limiter, f"agent-action:{actor.tenant_id}:{actor.actor_id}", _ACTION_RATE_LIMIT)
    try:
        return await confirmations.confirm(actor, action_id)
    except PendingActionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    except PendingActionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc


@router.post("/actions/{action_id}/cancel", response_model=ActionResultResponse)
async def cancel_action(
    action_id: UUID,
    actor: ActorContext = Depends(require_agent_access),
    confirmations: ConfirmationService = Depends(get_confirmation_service),
) -> ActionResultResponse:
    try:
        return await confirmations.cancel(actor, action_id)
    except PendingActionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    except PendingActionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc
