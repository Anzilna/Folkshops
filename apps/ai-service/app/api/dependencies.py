"""
Everything below reads already-constructed singletons off `request.app.state`
(built once in main.py's lifespan) — this file wires FastAPI's Depends()
plumbing, it never constructs a vendor adapter itself. The one exception is
get_current_actor: authentication is a per-request concern by nature.
"""

from dataclasses import dataclass
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request, status
from pydantic import SecretStr

from app.application.agent.agent_service import AgentService
from app.application.agent.confirmation import ConfirmationService
from app.application.chat.chat_service import ChatService
from app.application.documents.ingest import DocumentService, IngestionPipeline
from app.application.entitlements import AiEntitlement, EntitlementReason, EntitlementService
from app.application.rag.pipeline import RagPipeline
from app.config import Settings, get_settings
from app.domain.interfaces.tool_provider import ActorContext
from app.infrastructure.cache.redis import CacheService, RateLimiter
from app.infrastructure.persistence.postgres import Db
from app.observability.logging import bind_actor_context

STAFF_ACCESS_TOKEN_COOKIE = "fk_access_token"
CUSTOMER_ACCESS_TOKEN_COOKIE = "fk_customer_access_token"
PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE = "fk_pa_access_token"


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


def get_entitlement_service(request: Request) -> EntitlementService:
    return request.app.state.entitlement_service


def get_agent_service(request: Request) -> AgentService:
    return request.app.state.agent_service


def get_confirmation_service(request: Request) -> ConfirmationService:
    return request.app.state.confirmation_service


# async on purpose: FastAPI runs a plain `def` dependency in a threadpool on
# a copy of the request's contextvars, so bind_actor_context() inside it
# would be discarded on return and tenant_id would never reach the logs.
async def get_current_actor(request: Request, settings: Settings = Depends(get_settings)) -> ActorContext:
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
            return bind_actor_context(
                ActorContext(
                    tenant_id=payload["tenantId"],
                    actor_id=payload["sub"],
                    actor_type="staff",
                    role=payload.get("role"),
                    access_token=SecretStr(staff_token),
                )
            )
        except jwt.InvalidTokenError:
            pass

    customer_token = request.cookies.get(CUSTOMER_ACCESS_TOKEN_COOKIE)
    if customer_token:
        try:
            payload = jwt.decode(customer_token, settings.customer_jwt_secret, algorithms=["HS256"])
            return bind_actor_context(
                ActorContext(
                    tenant_id=payload["tenantId"],
                    actor_id=payload["sub"],
                    actor_type="customer",
                    access_token=SecretStr(customer_token),
                )
            )
        except jwt.InvalidTokenError:
            pass

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid access token")


_ENTITLEMENT_MESSAGES = {
    EntitlementReason.TENANT_SUSPENDED: "This store is currently suspended. Please contact Folkshops support.",
    EntitlementReason.NOT_IN_PLAN: "Your plan doesn't include AI features. Upgrade to use the Store Copilot.",
    EntitlementReason.SUBSCRIPTION_INACTIVE: "Your subscription isn't active. Complete payment to use AI features.",
    EntitlementReason.NO_SUBSCRIPTION: "No subscription found for this store.",
}


async def get_current_staff(actor: ActorContext = Depends(get_current_actor)) -> ActorContext:
    """
    The knowledge base and Store Copilot are merchant-admin features. A
    shopper's token must never upload into (or chat against) a store's
    knowledge base — the Shopper Agent is a separate, later surface.
    """
    if actor.actor_type != "staff":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff access required")
    return actor


async def _require_entitlement(actor: ActorContext, entitlements: EntitlementService) -> ActorContext:
    entitlement: AiEntitlement = await entitlements.ai_entitlement(UUID(actor.tenant_id))
    if not entitlement.allowed:
        raise HTTPException(
            # 403, not 402: a suspension is a refusal, not a plan the store could pay to fix.
            status_code=status.HTTP_403_FORBIDDEN
            if entitlement.reason is EntitlementReason.TENANT_SUSPENDED
            else status.HTTP_402_PAYMENT_REQUIRED,
            detail={"code": entitlement.reason.value, "message": _ENTITLEMENT_MESSAGES[entitlement.reason]},
        )
    return actor


async def require_ai_access(
    actor: ActorContext = Depends(get_current_staff),
    entitlements: EntitlementService = Depends(get_entitlement_service),
) -> ActorContext:
    """
    The server-side plan gate (application/entitlements.py). merchant-admin
    also hides the UI for a non-entitled plan, but that's cosmetic — this is
    the enforcement. 402 with a machine-readable reason so the UI can tell
    "upgrade your plan" apart from "fix your payment".
    """
    return await _require_entitlement(actor, entitlements)


async def require_agent_access(
    actor: ActorContext = Depends(get_current_actor),
    entitlements: EntitlementService = Depends(get_entitlement_service),
) -> ActorContext:
    """
    The agent serves both surfaces: staff get the Store Copilot, customers
    the Shopper Assistant (application/agent/profiles.py picks by token
    type). Either way the STORE's plan must include AI — the merchant pays
    for their shoppers' assistant, so a store without AI gets 402 for both.
    """
    return await _require_entitlement(actor, entitlements)


@dataclass(frozen=True)
class PlatformAdmin:
    admin_id: str


async def get_platform_admin(request: Request, settings: Settings = Depends(get_settings)) -> PlatformAdmin:
    """
    Authenticates a Folkshops platform admin for /platform/documents. Verified
    against PLATFORM_ADMIN_JWT_SECRET only, from the platform-admin cookie
    only: a store-staff or customer token can't pass (different secret AND
    different cookie). Deliberately NOT an ActorContext — that type is what
    the agent's policy code branches on, and a platform admin must never be
    mistaken for a store's staff.

    Unlike core-api's guard this does not re-check that the admin row still
    exists (this service has no access to platform_admins): a removed admin
    keeps this access until their <=15 min access token expires.
    """
    token = request.cookies.get(PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE)
    if token:
        try:
            payload = jwt.decode(token, settings.platform_admin_jwt_secret, algorithms=["HS256"])
            return PlatformAdmin(admin_id=payload["sub"])
        except jwt.InvalidTokenError:
            pass
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid platform admin token")
