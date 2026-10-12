"""
Plan-based access to the AI features (docs/decisions/0012's `plans.ai_access`,
previously stored but unenforced). Read straight from core-api's
`subscriptions`/`plans` tables through column-level grants
(migrations/0002) rather than an HTTP call back into core-api: one indexed
query under the same RLS tenant context every other query here uses, and an
upgrade/downgrade takes effect on the very next request (no cache to go
stale).

A tenant is entitled when its plan has ai_access AND the subscription is
paid up. `past_due` stays entitled (Stripe is still retrying the card — the
usual grace period); `incomplete` (a paid plan that never completed
Checkout) and `canceled` are not, since AI calls cost real money per
request, unlike the product limit, which ADR 0012 applies regardless of
status.
"""

from enum import Enum
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import text

from app.infrastructure.persistence.postgres import Db

_ENTITLED_STATUSES = {"active", "past_due"}


class EntitlementReason(str, Enum):
    OK = "ok"
    TENANT_SUSPENDED = "tenant_suspended"
    NOT_IN_PLAN = "not_in_plan"
    SUBSCRIPTION_INACTIVE = "subscription_inactive"
    NO_SUBSCRIPTION = "no_subscription"


class AiEntitlement(BaseModel):
    allowed: bool
    reason: EntitlementReason
    plan_slug: str | None = None
    plan_name: str | None = None
    subscription_status: str | None = None


class EntitlementService:
    def __init__(self, db: Db):
        self._db = db

    async def ai_entitlement(self, tenant_id: UUID) -> AiEntitlement:
        async with self._db.tenant_context(str(tenant_id)) as session:
            # Starts from `tenants` so a suspended store is caught even if it
            # also has no subscription row; the LEFT JOINs keep the row when
            # there is no plan to show.
            row = (
                await session.execute(
                    text(
                        "SELECT t.status::text AS tenant_status, p.slug, p.name, p.ai_access, s.status::text AS status "
                        "FROM tenants t "
                        "LEFT JOIN subscriptions s ON s.tenant_id = t.id "
                        "LEFT JOIN plans p ON p.id = s.plan_id "
                        "WHERE t.id = :tenant_id LIMIT 1"
                    ),
                    {"tenant_id": str(tenant_id)},
                )
            ).first()

        if row is not None and row.tenant_status == "suspended":
            # Platform-admin suspension (core-api StoreAvailableGuard) stops
            # the store's own pages; this stops the AI, which a still-valid
            # access token could otherwise keep calling for its last minutes.
            return AiEntitlement(allowed=False, reason=EntitlementReason.TENANT_SUSPENDED)
        if row is None or row.slug is None:
            return AiEntitlement(allowed=False, reason=EntitlementReason.NO_SUBSCRIPTION)

        details = {"plan_slug": row.slug, "plan_name": row.name, "subscription_status": row.status}
        if not row.ai_access:
            return AiEntitlement(allowed=False, reason=EntitlementReason.NOT_IN_PLAN, **details)
        if row.status not in _ENTITLED_STATUSES:
            return AiEntitlement(allowed=False, reason=EntitlementReason.SUBSCRIPTION_INACTIVE, **details)
        return AiEntitlement(allowed=True, reason=EntitlementReason.OK, **details)
