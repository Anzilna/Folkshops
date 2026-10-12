"""
Queues a reembed_document job (app/workers/embedding_worker.py) for every
document that has chunks with no embedding — what's left after switching
embedding models (migrations/0003 cleared every vector). Re-embeds from the
stored chunk text, so nothing needs re-uploading. Safe to re-run: a
document that's already re-embedded has no NULL chunks and is skipped.

Tenants come from core-api's `tenants` table, read with the schema-owning
role. document_chunks is FORCE-RLS, so each tenant is queried under its own
app.tenant_id, the same way the service itself reads it. Chunks whose tenant
isn't in `tenants` (leftovers from the integration tests' random tenant
ids) are skipped; search ignores them because their embedding stays NULL.

Usage — run it where the worker's Redis is, i.e. inside the ai-worker
container (a host-side `redis://localhost:6379` can hit a different Redis
than the containers use, e.g. a Homebrew one, and the jobs never run):
    docker exec \\
      -e MIGRATIONS_DATABASE_URL=postgres://folkshops:folkshops@postgres:5432/folkshops_dev \\
      -e REDIS_URL=redis://redis:6379 \\
      folkshops-ai-worker python scripts/reembed_all.py
"""

import asyncio
import os
import sys

import asyncpg
from arq import create_pool
from arq.connections import RedisSettings

from app.domain.models.document import PLATFORM_TENANT_ID


async def main() -> None:
    admin_url = os.environ.get("MIGRATIONS_DATABASE_URL")
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    if not admin_url:
        print("MIGRATIONS_DATABASE_URL is required (the schema-owning connection).", file=sys.stderr)
        sys.exit(1)

    conn = await asyncpg.connect(admin_url)
    pool = await create_pool(RedisSettings.from_dsn(redis_url))
    queued = 0
    try:
        tenant_ids = [r["id"] for r in await conn.fetch("SELECT id FROM tenants")]
        # Folkshops' own help documents live under the reserved platform
        # tenant, which isn't a row in `tenants` (docs/decisions/0017).
        tenant_ids.append(PLATFORM_TENANT_ID)
        for tenant_id in tenant_ids:
            async with conn.transaction():
                await conn.execute("SELECT set_config('app.tenant_id', $1, true)", str(tenant_id))
                # Explicit tenant filter as well as RLS: the local Docker owner
                # role is a superuser and bypasses RLS entirely, which would
                # otherwise queue every tenant's documents under this tenant.
                rows = await conn.fetch(
                    "SELECT DISTINCT document_id FROM document_chunks WHERE embedding IS NULL AND tenant_id = $1",
                    tenant_id,
                )
            for row in rows:
                await pool.enqueue_job("reembed_document", str(tenant_id), str(row["document_id"]))
                queued += 1
    finally:
        await pool.aclose()
        await conn.close()

    print(f"Queued {queued} reembed_document job(s).")


if __name__ == "__main__":
    asyncio.run(main())
