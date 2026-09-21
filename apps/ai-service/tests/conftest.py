"""
Real Postgres + Redis, same convention as core-api's own integration suite
(CLAUDE.md: "the mandatory RLS suite" runs against a real service
container, never a mock). Assumes `docker compose up -d postgres redis` and
that scripts/bootstrap_ai_role.py + migrations have already run — same
precondition core-api's own integration tests have for their schema.
"""

import uuid

import pytest
import pytest_asyncio

from app.infrastructure.cache.redis import CacheService
from app.infrastructure.embeddings.fake import FakeEmbeddingProvider
from app.infrastructure.persistence.postgres import Db, run_migrations
from app.infrastructure.vector_store.pgvector import PgVectorStore
from app.observability.metrics import Metrics

TEST_DATABASE_URL = "postgres://folkshops_ai:folkshops_ai@localhost:5432/folkshops_dev"
TEST_MIGRATIONS_URL = "postgres://folkshops:folkshops@localhost:5432/folkshops_dev"
TEST_REDIS_URL = "redis://localhost:6379"


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _apply_migrations():
    await run_migrations(TEST_MIGRATIONS_URL)


@pytest_asyncio.fixture
async def db():
    database = await Db.connect(TEST_DATABASE_URL)
    yield database
    await database.close()


@pytest_asyncio.fixture
async def vector_store(db):
    return PgVectorStore(db)


@pytest_asyncio.fixture
async def cache():
    service = CacheService(TEST_REDIS_URL)
    yield service
    await service.close()


@pytest.fixture
def metrics() -> Metrics:
    return Metrics("test-integration")


@pytest.fixture
def embeddings() -> FakeEmbeddingProvider:
    return FakeEmbeddingProvider()


@pytest_asyncio.fixture
async def real_tenant_id(db):
    """
    document_chunks has no FK to `tenants` (the AI service's own tables are
    intentionally decoupled from core-api's schema — see ADR 0011), so any
    UUID works for isolation tests. `documents` also has no FK to tenants
    for the same reason. A fresh UUID per test keeps tests independent
    without needing to clean up core-api's own tables.
    """
    return uuid.uuid4()


@pytest_asyncio.fixture
def make_document(db):
    """
    document_chunks DOES have a real FK to documents(id) — tests that
    upsert chunks directly against the vector store (bypassing
    DocumentService/IngestionPipeline) need a real parent row first, same
    as any other FK-backed table.
    """

    async def _make(tenant_id: uuid.UUID) -> uuid.UUID:
        async with db.tenant_context(str(tenant_id)) as conn:
            row = await conn.fetchrow(
                "INSERT INTO documents (tenant_id, filename, mime_type) VALUES ($1, 'test.txt', 'text/plain') RETURNING id",
                tenant_id,
            )
        return row["id"]

    return _make
