"""
The single most important test in this service: a vector search must never
return another tenant's chunks, enforced by real Postgres RLS
(`app.tenant_id`), not application-level filtering alone — spec section 3
("The architecture must prevent cross-tenant retrieval"). Runs against the
real Postgres this repo already runs, exactly like core-api's own mandatory
RLS suite.
"""

from uuid import uuid4

import pytest

from app.domain.models.chunk import Chunk


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


@pytest.mark.asyncio
async def test_search_never_returns_another_tenants_chunks(vector_store, embeddings, make_document):
    tenant_a, tenant_b = uuid4(), uuid4()
    doc_a, doc_b = await make_document(tenant_a), await make_document(tenant_b)

    vector_a = await embeddings.embed_query("Folkshops return policy details")
    vector_b = await embeddings.embed_query("Folkshops return policy details")  # identical text, different tenant

    await vector_store.upsert(tenant_a, [_chunk(doc_a, tenant_a, "Tenant A's secret return policy", vector_a)])
    await vector_store.upsert(tenant_b, [_chunk(doc_b, tenant_b, "Tenant B's secret return policy", vector_b)])

    results_a = await vector_store.search(tenant_a, vector_a, limit=10)
    results_b = await vector_store.search(tenant_b, vector_b, limit=10)

    assert len(results_a) == 1
    assert results_a[0].document_id == doc_a
    assert "Tenant A" in results_a[0].content

    assert len(results_b) == 1
    assert results_b[0].document_id == doc_b
    assert "Tenant B" in results_b[0].content


@pytest.mark.asyncio
async def test_search_with_no_matching_tenant_data_returns_empty(vector_store, embeddings):
    lonely_tenant = uuid4()
    query_vector = await embeddings.embed_query("anything at all")
    results = await vector_store.search(lonely_tenant, query_vector, limit=10)
    assert results == []


@pytest.mark.asyncio
async def test_delete_document_only_affects_its_own_tenant(vector_store, embeddings, make_document):
    tenant_a, tenant_b = uuid4(), uuid4()
    doc_a, doc_b = await make_document(tenant_a), await make_document(tenant_b)
    vector = await embeddings.embed_query("shared content")

    await vector_store.upsert(tenant_a, [_chunk(doc_a, tenant_a, "A's content", vector)])
    await vector_store.upsert(tenant_b, [_chunk(doc_b, tenant_b, "B's content", vector)])

    await vector_store.delete_document(tenant_a, doc_a)

    assert await vector_store.search(tenant_a, vector, limit=10) == []
    results_b = await vector_store.search(tenant_b, vector, limit=10)
    assert len(results_b) == 1  # tenant B's own document must be unaffected by tenant A's delete
