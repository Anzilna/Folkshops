"""
EntitlementService against real `plans`/`subscriptions` rows, read through
the folkshops_ai role's column-level grants (migrations/0002) and RLS —
not a mock, so a missing grant or a broken policy fails here.
"""

import uuid

import pytest

from app.application.entitlements import EntitlementReason, EntitlementService
from tests.billing_fixtures import set_tenant_status


@pytest.mark.parametrize(
    ("plan_slug", "status", "allowed", "reason"),
    [
        ("standard", "active", True, EntitlementReason.OK),
        ("advanced", "active", True, EntitlementReason.OK),
        ("standard", "past_due", True, EntitlementReason.OK),
        ("standard", "incomplete", False, EntitlementReason.SUBSCRIPTION_INACTIVE),
        ("standard", "canceled", False, EntitlementReason.SUBSCRIPTION_INACTIVE),
        ("basic", "active", False, EntitlementReason.NOT_IN_PLAN),
        ("free", "active", False, EntitlementReason.NOT_IN_PLAN),
    ],
)
async def test_ai_entitlement_follows_plan_and_status(db, make_subscribed_tenant, plan_slug, status, allowed, reason):
    tenant_id = await make_subscribed_tenant(plan_slug, status)

    entitlement = await EntitlementService(db).ai_entitlement(tenant_id)

    assert entitlement.allowed is allowed
    assert entitlement.reason == reason
    assert entitlement.plan_slug == plan_slug
    assert entitlement.subscription_status == status


async def test_tenant_without_subscription_is_not_entitled(db):
    entitlement = await EntitlementService(db).ai_entitlement(uuid.uuid4())

    assert entitlement.allowed is False
    assert entitlement.reason == EntitlementReason.NO_SUBSCRIPTION


async def test_rls_hides_other_tenants_subscription(db, make_subscribed_tenant):
    """The query filters by tenant_id itself, but RLS must also hold if it didn't."""
    from sqlalchemy import text

    entitled = await make_subscribed_tenant("advanced", "active")
    other = await make_subscribed_tenant("basic", "active")

    async with db.tenant_context(str(other)) as session:
        visible = (await session.execute(text("SELECT tenant_id FROM subscriptions"))).scalars().all()

    assert visible == [other]
    assert entitled not in visible


async def test_suspended_tenant_is_never_entitled_whatever_its_plan(db, make_subscribed_tenant):
    tenant_id = await make_subscribed_tenant("advanced", "active")
    assert (await EntitlementService(db).ai_entitlement(tenant_id)).allowed is True

    await set_tenant_status(tenant_id, "suspended")
    suspended = await EntitlementService(db).ai_entitlement(tenant_id)
    assert suspended.allowed is False
    assert suspended.reason == EntitlementReason.TENANT_SUSPENDED

    await set_tenant_status(tenant_id, "active")
    assert (await EntitlementService(db).ai_entitlement(tenant_id)).allowed is True
