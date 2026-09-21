"""
The only file that assembles concrete infrastructure adapters into the
interfaces application/api code depends on (spec rule: don't put all AI
logic in main.py — this file does DI wiring only, no business logic).
"""

import logging
import time
import uuid
from contextlib import asynccontextmanager

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import chat, documents, health
from app.config import get_settings
from app.domain.errors import AppError
from app.infrastructure.cache.redis import CacheService, RateLimiter
from app.infrastructure.embeddings.router import build_embedding_provider
from app.infrastructure.llm.router import build_llm_provider
from app.infrastructure.messaging.kafka import KafkaEventPublisher, NullEventPublisher
from app.infrastructure.persistence.postgres import Db, run_migrations
from app.infrastructure.reranker.cross_encoder import CrossEncoderReranker
from app.infrastructure.vector_store.router import build_vector_store
from app.observability.logging import bind_request_context, clear_request_context, configure_logging, get_logger
from app.observability.metrics import Metrics
from app.observability.tracing import configure_tracing, instrument_app

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.app_env)
    configure_tracing(settings.otel_service_name, settings.otel_exporter_otlp_endpoint)

    await run_migrations(settings.migrations_database_url)

    db = await Db.connect(settings.database_url)
    cache = CacheService(settings.redis_url)
    rate_limiter = RateLimiter.from_url(settings.redis_url)
    metrics = Metrics(settings.otel_service_name)

    embeddings = build_embedding_provider(settings)
    llm = build_llm_provider(settings)
    vector_store = build_vector_store(settings, db)
    reranker = CrossEncoderReranker() if settings.reranker_enabled else None
    events = KafkaEventPublisher(settings.kafka_brokers) if settings.kafka_events_enabled else NullEventPublisher()

    from app.application.chat.chat_service import ChatService
    from app.application.documents.chunk import RecursiveTextChunker
    from app.application.documents.index import DocumentIndexer
    from app.application.documents.ingest import DocumentService, IngestionPipeline
    from app.application.rag.context import ContextBuilder
    from app.application.rag.pipeline import RagPipeline
    from app.application.rag.rerank import RerankStep
    from app.application.rag.retrieve import Retriever

    retriever = Retriever(embeddings, vector_store, cache, metrics)
    rerank_step = RerankStep(reranker, metrics)
    context_builder = ContextBuilder()
    rag_pipeline = RagPipeline(retriever, rerank_step, context_builder)

    document_service = DocumentService(db, events)
    indexer = DocumentIndexer(embeddings, vector_store)
    chunker = RecursiveTextChunker()
    ingestion_pipeline = IngestionPipeline(document_service, chunker, indexer)

    chat_service = ChatService(db, rag_pipeline, llm, settings.openai_chat_model, metrics)

    arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))

    app.state.settings = settings
    app.state.db = db
    app.state.cache = cache
    app.state.rate_limiter = rate_limiter
    app.state.metrics = metrics
    app.state.vector_store = vector_store
    app.state.rag_pipeline = rag_pipeline
    app.state.chat_service = chat_service
    app.state.document_service = document_service
    app.state.ingestion_pipeline = ingestion_pipeline
    app.state.arq_pool = arq_pool

    logger.info(
        "ai-service started: llm=%s embeddings=%s vector_store=%s",
        settings.llm_provider,
        settings.embedding_provider,
        settings.vector_store,
    )

    yield

    await arq_pool.aclose()
    await cache.close()
    await db.close()


app = FastAPI(title="Folkshops AI Service", lifespan=lifespan)
instrument_app(app)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    """Binds request_id/trace_id for structured logging and records HTTP latency (spec section 23)."""
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    trace_id = request.headers.get("x-trace-id")
    bind_request_context(request_id=request_id, tenant_id=None, trace_id=trace_id)

    start = time.monotonic()
    try:
        response = await call_next(request)
    finally:
        duration_ms = (time.monotonic() - start) * 1000
        request.app.state.metrics.request_latency.record(
            duration_ms, {"path": request.url.path, "method": request.method}
        )
        clear_request_context()
    response.headers["x-request-id"] = request_id
    return response


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """
    Structured application errors (spec rule 27) — never leak a raw
    provider exception (an openai.APIError, an asyncpg error) to the
    client; every infrastructure adapter already wraps its own vendor
    exceptions into one of these before it escapes.
    """
    request.app.state.metrics.errors.add(1, {"type": type(exc).__name__})
    logger = get_logger(__name__)
    logger.error("app_error", error_type=type(exc).__name__, message=exc.message)
    return JSONResponse(status_code=500, content={"error": type(exc).__name__, "message": exc.message})


app.include_router(health.router)
app.include_router(documents.router)
app.include_router(chat.router)
