"""
SQLAlchemy 2.0 (async, asyncpg driver underneath) for every query this
service makes — see models.py for the table mappings. This module is the
ONLY place an engine/connection pool is created; every adapter/service
takes a Db via dependency injection.

Migrations deliberately stay hand-written SQL run over a plain asyncpg
connection (run_migrations below), not Alembic: the schema's RLS policies,
GRANTs and ivfflat index aren't expressible as SQLAlchemy models, so
autogenerate couldn't produce them anyway. See docs/decisions/0011.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent.parent.parent.parent / "migrations"


def to_sqlalchemy_url(dsn: str) -> str:
    """
    DATABASE_URL uses the plain `postgres://` form core-api's own env vars
    use; SQLAlchemy needs the dialect+driver spelled out to pick asyncpg.
    """
    for prefix in ("postgresql://", "postgres://"):
        if dsn.startswith(prefix):
            return "postgresql+asyncpg://" + dsn[len(prefix) :]
    return dsn


class Db:
    def __init__(self, engine: AsyncEngine):
        self._engine = engine
        # expire_on_commit=False: rows stay readable after their transaction
        # commits. With the default (True), touching any attribute afterwards
        # triggers a lazy reload, which an async session can't do implicitly
        # and raises MissingGreenlet instead.
        self._sessions = async_sessionmaker(engine, expire_on_commit=False)

    @classmethod
    async def connect(cls, dsn: str) -> "Db":
        # pool_size + max_overflow = the same 10-connection ceiling the
        # previous raw asyncpg pool had.
        #
        # No pgvector.asyncpg.register_vector() here (the raw-asyncpg setup
        # needed it): models.py's Vector column type already converts
        # list[float] <-> pgvector's text format itself, and registering the
        # asyncpg codec on top makes the two fight over the same parameter.
        engine = create_async_engine(to_sqlalchemy_url(dsn), pool_size=5, max_overflow=5)
        return cls(engine)

    async def close(self) -> None:
        await self._engine.dispose()

    @asynccontextmanager
    async def tenant_context(self, tenant_id: str) -> AsyncIterator[AsyncSession]:
        """
        The Python analog of core-api's withTenantContext: SET LOCAL inside a
        transaction, never a bare SET (which would leak onto a pooled
        connection reused by the next request/tenant — same reasoning as
        apps/core-api/src/database/tenant-context.ts). set_config's third
        argument (is_local=true) scopes the setting to this transaction only.

        session.begin() commits when the block exits normally and rolls back
        if it raises — callers never call commit() themselves.
        """
        async with self._sessions() as session, session.begin():
            await session.execute(
                text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id}
            )
            yield session

    async def health_check(self) -> bool:
        try:
            async with self._engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
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
