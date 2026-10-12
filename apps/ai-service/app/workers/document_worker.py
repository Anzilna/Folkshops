"""
arq worker process (Redis-backed job queue — see docs/decisions/0011 for
why arq/Redis rather than Kafka backs ingestion). Run with:

    arq app.workers.document_worker.WorkerSettings

One process, two task modules (this file + embedding_worker.py) registered
into the same WorkerSettings — running two separate OS processes for a
Phase-1-sized ingestion pipeline would be premature horizontal complexity
(rule 30: start simple). Splitting the module files (rather than the
process) still gets the real benefit the spec's folder structure implies:
`ingest_document` (parse+chunk+embed+index, for a brand-new upload) and
`reembed_document` (embed+index only, for re-embedding already-parsed
content — see embedding_worker.py) are independently retryable jobs with
different inputs and different failure modes.
"""

import asyncio
import logging

from arq.connections import RedisSettings

from app.application.documents.chunk import RecursiveTextChunker
from app.application.documents.index import DocumentIndexer
from app.application.documents.ingest import DocumentService, IngestionPipeline
from app.config import get_settings
from app.infrastructure.embeddings.router import build_embedding_provider, warm_up_embeddings
from app.infrastructure.messaging.kafka import KafkaEventPublisher, NullEventPublisher
from app.infrastructure.persistence.postgres import Db
from app.infrastructure.vector_store.router import build_vector_store
from app.observability.logging import configure_logging
from app.workers.embedding_worker import reembed_document

logger = logging.getLogger(__name__)


async def startup(ctx: dict) -> None:
    settings = get_settings()
    configure_logging(settings.app_env)

    db = await Db.connect(settings.database_url)
    embeddings = build_embedding_provider(settings)
    # Background, not awaited — same reasoning as main.py's lifespan.
    ctx["embeddings_warm_up"] = asyncio.create_task(warm_up_embeddings(embeddings))
    vector_store = build_vector_store(settings, db)
    events = KafkaEventPublisher(settings.kafka_brokers) if settings.kafka_events_enabled else NullEventPublisher()

    document_service = DocumentService(db, events)
    indexer = DocumentIndexer(embeddings, vector_store)
    chunker = RecursiveTextChunker()

    ctx["db"] = db
    ctx["document_service"] = document_service
    ctx["indexer"] = indexer
    ctx["ingestion_pipeline"] = IngestionPipeline(document_service, chunker, indexer)
    logger.info("document_worker started")


async def shutdown(ctx: dict) -> None:
    await ctx["db"].close()


async def ingest_document(ctx: dict, tenant_id: str, document_id: str, content: bytes, mime_type: str) -> None:
    from uuid import UUID

    pipeline: IngestionPipeline = ctx["ingestion_pipeline"]
    await pipeline.run(UUID(tenant_id), UUID(document_id), content, mime_type)


class WorkerSettings:
    functions = [ingest_document, reembed_document]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
