"""
GET /entitlement — what merchant-admin reads to decide between showing the
Store Copilot/knowledge base and an upgrade prompt. Deliberately NOT behind
require_ai_access itself: a store without AI needs this answer most.
Display only; the enforcement is require_ai_access on every gated route.
"""

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_staff, get_entitlement_service
from app.application.entitlements import AiEntitlement, EntitlementService
from app.domain.interfaces.tool_provider import ActorContext

router = APIRouter(tags=["entitlement"])


@router.get("/entitlement", response_model=AiEntitlement)
async def entitlement(
    actor: ActorContext = Depends(get_current_staff),
    entitlements: EntitlementService = Depends(get_entitlement_service),
) -> AiEntitlement:
    return await entitlements.ai_entitlement(UUID(actor.tenant_id))
