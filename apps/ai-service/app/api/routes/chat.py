from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_chat_service, get_current_actor, get_rate_limiter
from app.application.chat.chat_service import ChatService
from app.domain.interfaces.tool_provider import ActorContext
from app.domain.models.chat import ChatRequest, ChatResponse
from app.infrastructure.cache.redis import RateLimiter

router = APIRouter(tags=["chat"])

_CHAT_RATE_LIMIT = 20
_CHAT_RATE_WINDOW_SECONDS = 60


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    actor: ActorContext = Depends(get_current_actor),
    chat_service: ChatService = Depends(get_chat_service),
    rate_limiter: RateLimiter = Depends(get_rate_limiter),
) -> ChatResponse:
    allowed = await rate_limiter.check(
        f"chat:{actor.tenant_id}:{actor.actor_id}", _CHAT_RATE_LIMIT, _CHAT_RATE_WINDOW_SECONDS
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")

    return await chat_service.send_message(
        tenant_id=UUID(actor.tenant_id),
        actor_id=actor.actor_id,
        conversation_id=body.conversation_id,
        message=body.message,
    )
