# @folkshops/ai-service

Python/FastAPI RAG + chat service — document ingestion, vector retrieval, and LLM chat, architected so the LLM provider, embedding provider, vector database, reranker, tool/MCP implementation, and model-routing strategy can each be swapped without touching `app/application/` or `app/api/`. See `docs/decisions/0011-ai-service-architecture.md` for the full design and every major decision's rationale (this is a Phase 3 feature pulled forward — that ADR records why).

Phase 1 scope only (health, ingestion, retrieval, single-provider chat, tenant isolation) — see the ADR's "what's deliberately not built" section for Phase 2/3.

## Layout

```
app/
    api/            FastAPI routers + auth dependency — HTTP only, no business logic
    application/    chat/rag/documents use-cases — depends only on domain/interfaces
    domain/         Pydantic models + Protocol interfaces — no I/O, no vendor imports
    infrastructure/ vendor adapters (OpenAI, pgvector, Redis, Kafka, ...) — the only place a vendor SDK is imported;
                    persistence/models.py holds the SQLAlchemy table mappings
    workers/        arq (Redis-backed) background jobs — ingestion never runs inside the HTTP request
    observability/  structured logging, OpenTelemetry tracing, metrics
    config.py       env-driven provider selection (never hard-coded)
migrations/         hand-written SQL (schema source of truth — keep persistence/models.py in sync), applied by infrastructure/persistence/postgres.py's run_migrations()
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

No OpenAI key required for local dev. `EMBEDDING_PROVIDER=local` (the `.env.example` default) runs `BAAI/bge-small-en-v1.5` in-process for real semantic search; the ~130MB model downloads on first start. `LLM_PROVIDER=fake` is still a deterministic stand-in for the chat model. `EMBEDDING_PROVIDER=fake` (hash-based, no download) also works. The schema is `vector(384)` (migrations/0003); OpenAI's 1536-wide embeddings need a migration. After switching embedding models, re-embed stored chunks with `scripts/reembed_all.py` (see its docstring).

## Running the tests

```bash
python -m pytest tests/unit -q                       # no external dependencies
python -m pytest tests/integration tests/evaluation -q   # needs `docker compose up -d postgres redis` + the role/migrations above
```

## Endpoints

Every route except `/health` and `/entitlement` requires a **staff** token **and** a plan that includes AI (`plans.ai_access` with subscription `active`/`past_due`). It returns 403 for customers and 402 `{detail: {code, message}}` for a plan without AI. See ADR 0011's plan-gating addendum.

- `GET /health` — Postgres/Redis/vector-store health
- `GET /entitlement` — staff only, not plan-gated: `{allowed, reason, plan_slug, plan_name, subscription_status}`, used by merchant-admin to pick between the UI and an upgrade prompt
- `POST /documents` — multipart upload, returns 202 immediately; ingestion runs in the `arq` worker (`ai-worker` in docker-compose)
- `GET /documents` — paginated `{data,total,page,limit,totalPages}`, `?page&limit&search&status&sortBy&sortDir`
- `GET /documents/{id}` / `DELETE /documents/{id}` — status / hard delete (chunks cascade), tenant-scoped
- `POST /chat` — RAG-only chat (no tools), returns `{conversation_id, answer, citations[{document_id, chunk_id, score, filename}]}`. Superseded in the UI by `/agent/chat`.
- `POST /agent/chat` — the tool-calling agent: staff token → Store Copilot, customer token → Shopper Assistant (the store's plan must include AI either way). Body `{message, conversation_id?, client_message_id?}`; returns `{conversation_id, run_id, answer, status, citations, actions, activity}`.
- `POST /agent/actions/{id}/confirm` / `.../cancel` — run or discard a change the copilot proposed, exactly as shown on its card.

The agent's commerce tools come from core-api's MCP endpoints (`CORE_API_URL` + `INTERNAL_SERVICE_TOKEN`). Without them it still runs with `knowledge_search`. Real model: `LLM_PROVIDER=gemini` + `GEMINI_API_KEY`. See `docs/decisions/0015-agent-and-mcp.md`.

Auth: verifies the same `fk_access_token` cookie core-api issues (shared `JWT_SECRET`); this service never issues its own tokens. merchant-admin calls it directly cross-origin (`NEXT_PUBLIC_AI_URL`) from `/knowledge` and the Store Copilot chat.
