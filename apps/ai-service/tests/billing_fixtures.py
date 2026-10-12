"""
Real `tenants` + `subscriptions` rows for plan-entitlement tests. These are
core-api's tables, so they're written with the schema-owning role (the
folkshops_ai app role can only SELECT a few of their columns — see
migrations/0002). Unlike this service's own tables, `subscriptions` has a
real FK to `tenants`, so a random UUID isn't enough here.
"""

import uuid

import asyncpg

OWNER_DATABASE_URL = "postgres://folkshops:folkshops@localhost:5432/folkshops_dev"


async def create_subscribed_tenant(plan_slug: str, status: str = "active") -> uuid.UUID:
    tenant_id = uuid.uuid4()
    conn = await asyncpg.connect(OWNER_DATABASE_URL)
    try:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)",
                tenant_id,
                "AI test store",
                f"ai-test-{tenant_id.hex[:12]}",
            )
            await conn.execute("SELECT set_config('app.tenant_id', $1, true)", str(tenant_id))
            await conn.execute(
                "INSERT INTO subscriptions (tenant_id, plan_id, status) "
                "SELECT $1, id, $3::subscription_status FROM plans WHERE slug = $2",
                tenant_id,
                plan_slug,
                status,
            )
    finally:
        await conn.close()
    return tenant_id


async def set_tenant_status(tenant_id: uuid.UUID, status: str) -> None:
    """What a platform admin's suspend/reactivate does to the `tenants` row (core-api owns the real flow)."""
    conn = await asyncpg.connect(OWNER_DATABASE_URL)
    try:
        await conn.execute("UPDATE tenants SET status = $2::tenant_status WHERE id = $1", tenant_id, status)
    finally:
        await conn.close()


async def delete_tenant(tenant_id: uuid.UUID) -> None:
    conn = await asyncpg.connect(OWNER_DATABASE_URL)
    try:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.tenant_id', $1, true)", str(tenant_id))
            for table in ("subscriptions", "messages", "conversations", "documents"):
                await conn.execute(f"DELETE FROM {table} WHERE tenant_id = $1", tenant_id)
            await conn.execute("DELETE FROM tenants WHERE id = $1", tenant_id)
    finally:
        await conn.close()
