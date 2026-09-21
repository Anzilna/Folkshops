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

    cors_origins: str = Field(default="http://localhost:3001", alias="CORS_ORIGINS")

    # --- Provider selection (swap-seams) ---
    llm_provider: str = Field(default="fake", alias="LLM_PROVIDER")  # openai | fake
    embedding_provider: str = Field(default="fake", alias="EMBEDDING_PROVIDER")  # openai | fake
    vector_store: str = Field(default="pgvector", alias="VECTOR_STORE")  # pgvector | qdrant
    reranker_enabled: bool = Field(default=False, alias="RERANKER_ENABLED")
    model_router_enabled: bool = Field(default=False, alias="MODEL_ROUTER_ENABLED")
    tools_enabled: bool = Field(default=False, alias="TOOLS_ENABLED")
    kafka_events_enabled: bool = Field(default=False, alias="KAFKA_EVENTS_ENABLED")

    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_chat_model: str = Field(default="gpt-4o-mini", alias="OPENAI_CHAT_MODEL")
    openai_embedding_model: str = Field(default="text-embedding-3-small", alias="OPENAI_EMBEDDING_MODEL")

    # Schema-time constant — see ADR 0011 ("Embedding dimension is a
    # schema-time constant, not runtime-configurable"). Must match the
    # `vector(N)` width in migrations/0001_init.sql.
    embedding_dimensions: int = Field(default=1536, alias="EMBEDDING_DIMENSIONS")

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
