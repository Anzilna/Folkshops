"""
Platform knowledge (docs/decisions/0017): Folkshops' help content is readable
by every store's Copilot but never writable by one, and never reaches a
caller that didn't opt in. Real Postgres + RLS, like test_tenant_isolation.
"""

from uuid import uuid4

import pytest
from sqlalchemy import delete, update
from sqlalchemy.exc import DBAPIError

from app.application.documents.ingest import DocumentService
from app.domain.errors import DocumentNotFound
from app.domain.models.chunk import Chunk
from app.domain.models.document import PLATFORM_TENANT_ID
from app.infrastructure.messaging.kafka import NullEventPublisher
from app.infrastructure.persistence.models import DocumentRow


def _chunk(document_id, tenant_id, content: str, embedding: list[float]) -> Chunk:
    return Chunk(
        id=uuid4(),
        document_id=document_id,
        tenant_id=tenant_id,
        chunk_index=0,
        content=content,
        char_count=len(content),
        embedding=embedding,
    )


@pytest.fixture(autouse=True)
async def _clean_platform(db):
    async def wipe():
        async with db.tenant_context(str(PLATFORM_TENANT_ID)) as session:
            await session.execute(delete(DocumentRow).where(DocumentRow.tenant_id == PLATFORM_TENANT_ID))

    await wipe()
    yield
    await wipe()


@pytest.mark.asyncio
async def test_store_search_sees_platform_chunks_only_when_it_opts_in(vector_store, embeddings, make_document):
    store = uuid4()
    store_doc, platform_doc = await make_document(store), await make_document(PLATFORM_TENANT_ID)
    vector = await embeddings.embed_query("how do I connect stripe")
    await vector_store.upsert(store, [_chunk(store_doc, store, "Our own returns policy", vector)])
    platform_chunk = _chunk(platform_doc, PLATFORM_TENANT_ID, "Folkshops: connect Stripe", vector)
    await vector_store.upsert(PLATFORM_TENANT_ID, [platform_chunk])

    with_platform = await vector_store.search(store, vector, limit=10, include_platform=True)
    without = await vector_store.search(store, vector, limit=10)

    assert {r.document_id for r in with_platform} == {store_doc, platform_doc}
    assert {r.document_id for r in without} == {store_doc}


@pytest.mark.asyncio
async def test_one_stores_documents_never_leak_through_platform_access(vector_store, embeddings, make_document):
    store_a, store_b = uuid4(), uuid4()
    doc_a = await make_document(store_a)
    vector = await embeddings.embed_query("shared words")
    await vector_store.upsert(store_a, [_chunk(doc_a, store_a, "Store A private", vector)])

    results = await vector_store.search(store_b, vector, limit=10, include_platform=True)
    assert results == []


@pytest.mark.asyncio
async def test_a_store_cannot_modify_or_delete_platform_rows(db, make_document):
    store = uuid4()
    platform_doc = await make_document(PLATFORM_TENANT_ID)

    async with db.tenant_context(str(store)) as session:
        updated = await session.execute(
            update(DocumentRow).where(DocumentRow.id == platform_doc).values(filename="hacked")
        )
        deleted = await session.execute(delete(DocumentRow).where(DocumentRow.id == platform_doc))
    assert updated.rowcount == 0
    assert deleted.rowcount == 0

    async with db.tenant_context(str(PLATFORM_TENANT_ID)) as session:
        row = await session.get(DocumentRow, platform_doc)
    assert row is not None and row.filename == "test.txt"


@pytest.mark.asyncio
async def test_a_store_cannot_insert_a_platform_row(db):
    store = uuid4()
    with pytest.raises(DBAPIError):
        async with db.tenant_context(str(store)) as session:
            session.add(
                DocumentRow(tenant_id=PLATFORM_TENANT_ID, filename="x.txt", mime_type="text/plain", scope="platform")
            )
            await session.flush()


@pytest.mark.asyncio
async def test_scope_must_agree_with_tenant_id(db):
    store = uuid4()
    with pytest.raises(DBAPIError):
        async with db.tenant_context(str(store)) as session:
            session.add(DocumentRow(tenant_id=store, filename="x.txt", mime_type="text/plain", scope="platform"))
            await session.flush()


@pytest.mark.asyncio
async def test_store_document_routes_never_list_or_get_platform_documents(db):
    store = uuid4()
    service = DocumentService(db, NullEventPublisher())
    platform_doc = await service.create(PLATFORM_TENANT_ID, "help.md", "text/markdown")
    own_doc = await service.create(store, "mine.md", "text/markdown")

    listed = await service.list_for_tenant(store)
    assert [d.id for d in listed.data] == [own_doc.id]
    with pytest.raises(DocumentNotFound):
        await service.get(store, platform_doc.id)

    platform_listed = await service.list_for_tenant(PLATFORM_TENANT_ID)
    assert [d.id for d in platform_listed.data] == [platform_doc.id]
    assert platform_doc.scope.value == "platform"

    labels = await service.labels(store, [platform_doc.id, own_doc.id])
    assert labels[platform_doc.id] == ("help.md", "platform")
    assert labels[own_doc.id] == ("mine.md", "tenant")
