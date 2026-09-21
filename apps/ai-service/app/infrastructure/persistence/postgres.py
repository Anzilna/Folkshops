"""
Raw asyncpg, no ORM — same choice core-api made with Drizzle-on-pg.Pool over
Prisma (see docs/decisions/0011). This module is the ONLY place a Postgres
connection pool is created; every adapter/service takes a Db (this module's
Pool wrapper) via dependency injection.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg
from pgvector.asyncpg import register_vector

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent.parent.parent.parent / "migrations"


async def _init_connection(conn: asyncpg.Connection) -> None:
    await register_vector(conn)


class Db:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    @classmethod
    async def connect(cls, dsn: str) -> "Db":
        pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10, init=_init_connection)
        return cls(pool)

    async def close(self) -> None:
        await self._pool.close()

    @asynccontextmanager
    async def tenant_context(self, tenant_id: str) -> AsyncIterator[asyncpg.Connection]:
        """
        The Python analog of core-api's withTenantContext: SET LOCAL inside a
        transaction, never a bare SET (which would leak onto a pooled
        connection reused by the next request/tenant — same reasoning as
        apps/core-api/src/database/tenant-context.ts). set_config's third
        argument (is_local=true) scopes the setting to this transaction only.
        """
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT set_config('app.tenant_id', $1, true)", tenant_id)
            yield conn

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[asyncpg.Connection]:
        """For non-tenant-scoped reads (e.g. health checks, migration bookkeeping) — no RLS context is set."""
        async with self._pool.acquire() as conn:
            yield conn

    async def health_check(self) -> bool:
        try:
            async with self._pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            return True
        except Exception:
            logger.exception("postgres health check failed")
            return False


async def run_migrations(dsn: str) -> None:
    """
    Hand-written .sql files, applied in filename order, tracked in
    ai_schema_migrations — the same "plain SQL, no framework" posture as
    database/migrations/ on the Node side, run with the schema-owning
    `folkshops` role (never the RLS-subject `folkshops_ai` app role, which
    must never hold DDL privileges — same separation CLAUDE.md documents
    for core-api's own two roles).
    """
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_schema_migrations (
                filename text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        applied = {r["filename"] for r in await conn.fetch("SELECT filename FROM ai_schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in applied:
                continue
            logger.info("applying migration %s", path.name)
            sql = path.read_text()
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO ai_schema_migrations (filename) VALUES ($1)", path.name
                )
    finally:
        await conn.close()
