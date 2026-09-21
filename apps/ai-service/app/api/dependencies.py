"""
Everything below reads already-constructed singletons off `request.app.state`
(built once in main.py's lifespan) — this file wires FastAPI's Depends()
plumbing, it never constructs a vendor adapter itself. The one exception is
get_current_actor: authentication is a per-request concern by nature.
"""

import jwt
from fastapi import Depends, HTTPException, Request, status

from app.application.chat.chat_service import ChatService
from app.application.documents.ingest import DocumentService, IngestionPipeline
from app.application.rag.pipeline import RagPipeline
from app.config import Settings, get_settings
from app.domain.interfaces.tool_provider import ActorContext
from app.infrastructure.cache.redis import CacheService, RateLimiter
from app.infrastructure.persistence.postgres import Db

STAFF_ACCESS_TOKEN_COOKIE = "fk_access_token"
CUSTOMER_ACCESS_TOKEN_COOKIE = "fk_customer_access_token"


def get_db(request: Request) -> Db:
    return request.app.state.db


def get_cache(request: Request) -> CacheService:
    return request.app.state.cache


def get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def get_rag_pipeline(request: Request) -> RagPipeline:
    return request.app.state.rag_pipeline


def get_chat_service(request: Request) -> ChatService:
    return request.app.state.chat_service


def get_document_service(request: Request) -> DocumentService:
    return request.app.state.document_service


def get_ingestion_pipeline(request: Request) -> IngestionPipeline:
    return request.app.state.ingestion_pipeline


def get_current_actor(request: Request, settings: Settings = Depends(get_settings)) -> ActorContext:
    """
    Verifies the SAME cookies core-api issues (fk_access_token /
    fk_customer_access_token) against the shared secrets — this service
    issues no tokens of its own. tenant_id/actor_id come ONLY from the
    verified payload, never from a header/body/query param the caller
    controls. Mirrors apps/analytics' StaffJwtGuard precedent exactly (see
    docs/decisions/0011).
    """
    staff_token = request.cookies.get(STAFF_ACCESS_TOKEN_COOKIE)
    if staff_token:
        try:
            payload = jwt.decode(staff_token, settings.jwt_secret, algorithms=["HS256"])
            return ActorContext(tenant_id=payload["tenantId"], actor_id=payload["sub"], actor_type="staff")
        except jwt.InvalidTokenError:
            pass

    customer_token = request.cookies.get(CUSTOMER_ACCESS_TOKEN_COOKIE)
    if customer_token:
        try:
            payload = jwt.decode(customer_token, settings.customer_jwt_secret, algorithms=["HS256"])
            return ActorContext(tenant_id=payload["tenantId"], actor_id=payload["sub"], actor_type="customer")
        except jwt.InvalidTokenError:
            pass

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid access token")
