from uuid import uuid4

import pytest

from app.application.documents.chunk import RecursiveTextChunker
from app.application.documents.index import DocumentIndexer
from app.application.documents.ingest import DocumentService, IngestionPipeline
from app.domain.errors import UnsupportedDocumentType
from app.domain.models.document import DocumentStatus
from app.infrastructure.messaging.kafka import NullEventPublisher


@pytest.mark.asyncio
async def test_full_ingestion_pipeline_indexes_a_document(db, vector_store, embeddings):
    tenant_id = uuid4()
    documents = DocumentService(db, NullEventPublisher())
    indexer = DocumentIndexer(embeddings, vector_store)
    pipeline = IngestionPipeline(documents, RecursiveTextChunker(chunk_size=200), indexer)

    document = await documents.create(tenant_id, "policy.txt", "text/plain")
    assert document.status == DocumentStatus.UPLOADED

    content = b"Returns are accepted within 30 days.\n\nRefunds take 5 business days to process."
    await pipeline.run(tenant_id, document.id, content, "text/plain")

    updated = await documents.get(tenant_id, document.id)
    assert updated.status == DocumentStatus.INDEXED
    assert updated.error is None

    results = await vector_store.search(tenant_id, await embeddings.embed_query("refund timing"), limit=5)
    assert any("Refunds take 5 business days" in r.content for r in results)


@pytest.mark.asyncio
async def test_ingestion_marks_document_failed_on_unsupported_mime_type(db, vector_store, embeddings):
    tenant_id = uuid4()
    documents = DocumentService(db, NullEventPublisher())
    indexer = DocumentIndexer(embeddings, vector_store)
    pipeline = IngestionPipeline(documents, RecursiveTextChunker(), indexer)

    document = await documents.create(tenant_id, "weird.xyz", "application/x-weird")

    with pytest.raises(UnsupportedDocumentType):
        await pipeline.run(tenant_id, document.id, b"content", "application/x-weird")

    updated = await documents.get(tenant_id, document.id)
    assert updated.status == DocumentStatus.FAILED
    assert updated.error is not None


@pytest.mark.asyncio
async def test_reingesting_a_document_replaces_its_chunks_not_appends(db, vector_store, embeddings):
    """Idempotency (spec section 21): a retried ingestion job must not double up chunks for the same document."""
    tenant_id = uuid4()
    documents = DocumentService(db, NullEventPublisher())
    indexer = DocumentIndexer(embeddings, vector_store)
    pipeline = IngestionPipeline(documents, RecursiveTextChunker(chunk_size=50), indexer)

    document = await documents.create(tenant_id, "doc.txt", "text/plain")
    content = b"Short content that fits in one chunk."

    await pipeline.run(tenant_id, document.id, content, "text/plain")
    results_first = await vector_store.search(tenant_id, await embeddings.embed_query("short content"), limit=50)

    await pipeline.run(tenant_id, document.id, content, "text/plain")  # simulate a retry
    results_second = await vector_store.search(tenant_id, await embeddings.embed_query("short content"), limit=50)

    assert len(results_second) == len(results_first)
