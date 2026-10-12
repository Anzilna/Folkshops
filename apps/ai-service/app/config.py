"""
All provider/vendor selection is env-driven (rule: never hard-code provider
selection — see docs/decisions/0011). Nothing here imports a vendor SDK;
that only happens inside infrastructure/*, built by api/dependencies.py
reading this Settings object.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = Field(default="development", alias="APP_ENV")
    # Not 4200 — that's Angular CLI's own well-known default dev port and
    # collides with unrelated projects on a dev machine (confirmed live:
    # `ng serve` was already bound to it here), the same class of conflict
    # CLAUDE.md documents for the storefront's port 3000.
    port: int = Field(default=4400, alias="PORT")

    # App-role connection — least-privilege, RLS-subject (folkshops_ai, see
    # database/init/02-ai-role.sql). Migrations run as the schema-owning
    # `folkshops` role, same separation core-api already uses between
    # DATABASE_PRIMARY_URL and MIGRATIONS_DATABASE_URL.
    database_url: str = Field(
        default="postgres://folkshops_ai:folkshops_ai@localhost:5432/folkshops_dev",
        alias="DATABASE_URL",
    )
    migrations_database_url: str = Field(
        default="postgres://folkshops:folkshops@localhost:5432/folkshops_dev",
        alias="MIGRATIONS_DATABASE_URL",
    )

    redis_url: str = Field(default="redis://localhost:6379", alias="REDIS_URL")

    # Must match core-api's own secrets exactly — this service verifies the
    # same cookies core-api issues, it never issues its own. See ADR 0011.
    jwt_secret: str = Field(default="dev-only-change-me", alias="JWT_SECRET")
    customer_jwt_secret: str = Field(default="dev-only-change-me-three", alias="CUSTOMER_JWT_SECRET")
    # Platform-admin's own signing secret — verifies the fk_pa_access_token
    # cookie for the /platform/documents routes only (docs/decisions/0017).
    platform_admin_jwt_secret: str = Field(default="dev-only-change-me-too", alias="PLATFORM_ADMIN_JWT_SECRET")

    cors_origins: str = Field(default="http://localhost:3001", alias="CORS_ORIGINS")

    # --- Provider selection (swap-seams) ---
    llm_provider: str = Field(default="fake", alias="LLM_PROVIDER")  # gemini | openai | fake
    embedding_provider: str = Field(default="fake", alias="EMBEDDING_PROVIDER")  # local | openai | fake
    vector_store: str = Field(default="pgvector", alias="VECTOR_STORE")  # pgvector | qdrant
    reranker_enabled: bool = Field(default=False, alias="RERANKER_ENABLED")
    kafka_events_enabled: bool = Field(default=False, alias="KAFKA_EVENTS_ENABLED")

    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_chat_model: str = Field(default="gpt-4o-mini", alias="OPENAI_CHAT_MODEL")

    # Model tiers (application/agent/model_router.py). Unset = the provider's
    # defaults from infrastructure/llm/router.py's resolve_models(). Model
    # ids live here, never in application code.
    llm_model_fast: str | None = Field(default=None, alias="LLM_MODEL_FAST")
    llm_model_standard: str | None = Field(default=None, alias="LLM_MODEL_STANDARD")
    llm_model_fallback: str | None = Field(default=None, alias="LLM_MODEL_FALLBACK")

    # USD per million tokens, for agent_runs.cost_usd_micros. 0 on Gemini's
    # free tier; set the paid prices to see what a run would really cost.
    llm_price_input_per_mtok: float = Field(default=0.0, alias="LLM_PRICE_INPUT_PER_MTOK")
    llm_price_output_per_mtok: float = Field(default=0.0, alias="LLM_PRICE_OUTPUT_PER_MTOK")
    llm_price_cached_per_mtok: float = Field(default=0.0, alias="LLM_PRICE_CACHED_PER_MTOK")

    # Platform-wide LLM requests/minute across EVERY tenant — a free-tier
    # vendor quota is per project, so one busy store would otherwise starve
    # the rest. 0 = no limit (paid tier, where quotas are generous).
    llm_global_rpm: int = Field(default=0, alias="LLM_GLOBAL_RPM")
    # The same, per store: LLM requests/minute any ONE tenant may use, so a
    # store with many shoppers chatting at once can't take the whole global
    # quota. Keep it below LLM_GLOBAL_RPM (about half on the free tier).
    # 0 = no per-store limit.
    llm_tenant_rpm: int = Field(default=0, alias="LLM_TENANT_RPM")

    # Agent runs per tenant per rolling 24h — counted in Postgres
    # (agent_runs), not Redis, so it holds even when Redis is down.
    agent_tenant_daily_runs: int = Field(default=1000, alias="AGENT_TENANT_DAILY_RUNS")

    # The agent's commerce tools: core-api's MCP endpoints (/internal/mcp/*).
    # Both unset = the agent runs with knowledge_search only. The token must
    # match core-api's INTERNAL_SERVICE_TOKEN.
    core_api_url: str | None = Field(default=None, alias="CORE_API_URL")
    internal_service_token: str | None = Field(default=None, alias="INTERNAL_SERVICE_TOKEN")
    openai_embedding_model: str = Field(default="text-embedding-3-small", alias="OPENAI_EMBEDDING_MODEL")
    # In-process sentence-transformers model (EMBEDDING_PROVIDER=local) — see
    # infrastructure/embeddings/local.py for the models it knows the width of.
    local_embedding_model: str = Field(default="BAAI/bge-small-en-v1.5", alias="LOCAL_EMBEDDING_MODEL")

    # Schema-time constant — see ADR 0011 ("Embedding dimension is a
    # schema-time constant, not runtime-configurable"). Must match the
    # `vector(N)` width set by migrations/0003 (384, bge-small-en-v1.5).
    embedding_dimensions: int = Field(default=384, alias="EMBEDDING_DIMENSIONS")

    kafka_brokers: str = Field(default="localhost:9092", alias="KAFKA_BROKERS")

    # OpenTelemetry — unset means "no exporter, console/no-op only" (fail
    # open, no collector required to boot this service in dev).
    otel_exporter_otlp_endpoint: str | None = Field(default=None, alias="OTEL_EXPORTER_OTLP_ENDPOINT")
    otel_service_name: str = Field(default="folkshops-ai-service", alias="OTEL_SERVICE_NAME")

    # Ingestion limits — enforced in application/documents/ingest.py before
    # a job is ever queued.
    max_upload_bytes: int = Field(default=20 * 1024 * 1024, alias="MAX_UPLOAD_BYTES")


@lru_cache
def get_settings() -> Settings:
    return Settings()
