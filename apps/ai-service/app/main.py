"""
The only file that assembles concrete infrastructure adapters into the
interfaces application/api code depends on (spec rule: don't put all AI
logic in main.py — this file does DI wiring only, no business logic).
"""

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import agent, chat, documents, entitlement, health, platform_documents
from app.config import get_settings
from app.domain.errors import AppError
from app.infrastructure.cache.redis import CacheService, RateLimiter
from app.infrastructure.embeddings.router import build_embedding_provider, warm_up_embeddings
from app.infrastructure.llm.router import build_llm_provider, resolve_models
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
    # Background, not awaited: a first-run model download can take minutes
    # and must not hold up startup (or fail the container healthcheck).
    # Held on app.state so the task isn't garbage-collected mid-run.
    app.state.embeddings_warm_up = asyncio.create_task(warm_up_embeddings(embeddings))
    llm = build_llm_provider(settings)
    models = resolve_models(settings)
    vector_store = build_vector_store(settings, db)
    reranker = CrossEncoderReranker() if settings.reranker_enabled else None
    events = KafkaEventPublisher(settings.kafka_brokers) if settings.kafka_events_enabled else NullEventPublisher()

    from app.application.agent.agent_service import AgentService
    from app.application.agent.budget import LlmPricing
    from app.application.agent.confirmation import ConfirmationService
    from app.application.agent.local_tools import LocalToolProvider
    from app.application.agent.model_router import ModelRouter
    from app.application.agent.policy import PolicyEngine
    from app.application.agent.store import AgentStore
    from app.application.agent.tool_executor import ToolExecutor
    from app.application.agent.tool_registry import ToolRegistry
    from app.application.chat.chat_service import ChatService
    from app.application.documents.chunk import RecursiveTextChunker
    from app.application.documents.index import DocumentIndexer
    from app.application.documents.ingest import DocumentService, IngestionPipeline
    from app.application.entitlements import EntitlementService
    from app.application.rag.context import ContextBuilder
    from app.application.rag.pipeline import RagPipeline
    from app.application.rag.rerank import RerankStep
    from app.application.rag.retrieve import Retriever
    from app.domain.tools.catalog import CATALOG

    retriever = Retriever(embeddings, vector_store, cache, metrics)
    rerank_step = RerankStep(reranker, metrics)
    context_builder = ContextBuilder()
    rag_pipeline = RagPipeline(retriever, rerank_step, context_builder)

    document_service = DocumentService(db, events)
    indexer = DocumentIndexer(embeddings, vector_store)
    chunker = RecursiveTextChunker()
    ingestion_pipeline = IngestionPipeline(document_service, chunker, indexer)

    chat_service = ChatService(db, rag_pipeline, llm, models.standard, metrics, document_service)
    entitlement_service = EntitlementService(db)

    # The agent (docs/decisions/0015). Commerce tools come from core-api's
    # MCP endpoints when configured; without them the agent still runs with
    # knowledge_search only.
    tool_providers: dict = {"local": LocalToolProvider(rag_pipeline, document_service)}
    if settings.core_api_url and settings.internal_service_token:
        from app.infrastructure.tools.mcp.adapter import McpToolProvider

        tool_providers["mcp"] = McpToolProvider(settings.core_api_url, settings.internal_service_token)
    agent_store = AgentStore(db)
    tool_registry = ToolRegistry(CATALOG, tool_providers)
    tool_executor = ToolExecutor(PolicyEngine(), metrics)
    confirmation_service = ConfirmationService(agent_store, tool_registry, tool_executor)
    agent_service = AgentService(
        store=agent_store,
        registry=tool_registry,
        executor=tool_executor,
        confirmations=confirmation_service,
        llm=llm,
        router=ModelRouter(fast=models.fast, standard=models.standard, fallback=models.fallback),
        pricing=LlmPricing(
            input_per_mtok=settings.llm_price_input_per_mtok,
            output_per_mtok=settings.llm_price_output_per_mtok,
            cached_per_mtok=settings.llm_price_cached_per_mtok,
        ),
        metrics=metrics,
        rate_limiter=rate_limiter,
        llm_global_rpm=settings.llm_global_rpm,
        llm_tenant_rpm=settings.llm_tenant_rpm,
        tenant_daily_runs=settings.agent_tenant_daily_runs,
    )

    arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))

    app.state.settings = settings
    app.state.db = db
    app.state.cache = cache
    app.state.rate_limiter = rate_limiter
    app.state.metrics = metrics
    app.state.vector_store = vector_store
    app.state.rag_pipeline = rag_pipeline
    app.state.chat_service = chat_service
    app.state.entitlement_service = entitlement_service
    app.state.agent_service = agent_service
    app.state.confirmation_service = confirmation_service
    app.state.document_service = document_service
    app.state.ingestion_pipeline = ingestion_pipeline
    app.state.arq_pool = arq_pool

    logger.info(
        "ai-service started: llm=%s models=%s/%s embeddings=%s vector_store=%s mcp_tools=%s",
        settings.llm_provider,
        models.fast,
        models.standard,
        settings.embedding_provider,
        settings.vector_store,
        "mcp" in tool_providers,
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
app.include_router(platform_documents.router)
app.include_router(chat.router)
app.include_router(entitlement.router)
app.include_router(agent.router)
