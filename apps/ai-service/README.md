# @folkshops/ai-service

Python/FastAPI RAG + chat service — document ingestion, vector retrieval, and LLM chat, architected so the LLM provider, embedding provider, vector database, reranker, tool/MCP implementation, and model-routing strategy can each be swapped without touching `app/application/` or `app/api/`. See `docs/decisions/0011-ai-service-architecture.md` for the full design and every major decision's rationale (this is a Phase 3 feature pulled forward — that ADR records why).

Phase 1 scope only (health, ingestion, retrieval, single-provider chat, tenant isolation) — see the ADR's "what's deliberately not built" section for Phase 2/3.

## Layout

```
app/
    api/            FastAPI routers + auth dependency — HTTP only, no business logic
    application/    chat/rag/documents use-cases — depends only on domain/interfaces
    domain/         Pydantic models + Protocol interfaces — no I/O, no vendor imports
    infrastructure/ vendor adapters (OpenAI, pgvector, Redis, Kafka, ...) — the only place a vendor SDK is imported
    workers/        arq (Redis-backed) background jobs — ingestion never runs inside the HTTP request
    observability/  structured logging, OpenTelemetry tracing, metrics
    config.py       env-driven provider selection (never hard-coded)
migrations/         hand-written SQL, applied by infrastructure/persistence/postgres.py's run_migrations()
tests/
    unit/           chunking, context building, reranking, provider routers, tool registry — no I/O
    integration/    real Postgres + Redis — tenant isolation, ingestion pipeline, HTTP API
    evaluation/     retrieval-quality scaffold (spec section 24) — not "the endpoint returned 200"
```

## Local dev

```bash
cd apps/ai-service
python3.12 -m venv .venv && source .venv/bin/activate   # 3.12, not 3.14 — see note below
pip install -r requirements.txt
cp .env.example .env

# One-time, or whenever targeting a fresh Postgres (RDS included):
MIGRATIONS_DATABASE_URL=postgres://folkshops:folkshops@localhost:5432/folkshops_dev \
  python scripts/bootstrap_ai_role.py

uvicorn app.main:app --reload --port 4400   # also runs migrations at startup
arq app.workers.document_worker.WorkerSettings   # separate terminal — required for uploads to ever leave "uploaded"
```

**Python version**: use 3.11 or 3.12. `pydantic-core` (and other compiled deps) may not have prebuilt wheels for a brand-new Python release yet, which fails the install with a Rust/PyO3 compiler error — confirmed live against 3.14 in this environment; 3.12 installed clean.

**Postgres needs `pgvector`**: the shared `docker-compose.yml` at the repo root already runs `pgvector/pgvector:pg16` (swapped from plain `postgres:16-alpine`, see ADR 0011) — if you're pointed at a different Postgres, it needs the `vector` extension installed before migrations will succeed.

No OpenAI key required for local dev — `LLM_PROVIDER=fake`/`EMBEDDING_PROVIDER=fake` (the `.env.example` default) run the full pipeline deterministically with no network calls. Set both to `openai` and provide `OPENAI_API_KEY` to use the real thing.

## Running the tests

```bash
python -m pytest tests/unit -q                       # no external dependencies
python -m pytest tests/integration tests/evaluation -q   # needs `docker compose up -d postgres redis` + the role/migrations above
```

## Endpoints (Phase 1)

- `GET /health` — Postgres/Redis/vector-store health
- `POST /documents` — multipart upload (staff or customer auth), returns 202 immediately; ingestion runs in `arq` worker
- `GET /documents/{id}` / `GET /documents` — status + listing, tenant-scoped
- `POST /chat` — RAG-only chat (no tool-calling yet), returns `{conversation_id, answer, citations}`

Auth: verifies the same `fk_access_token`/`fk_customer_access_token` cookies core-api issues (shared `JWT_SECRET`/`CUSTOMER_JWT_SECRET`) — this service never issues its own tokens. Not yet wired into any frontend; test with a manually-minted JWT (see the ADR's live-verification notes) until merchant-admin/storefront call it.
