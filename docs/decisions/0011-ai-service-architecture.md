# 0011 — AI service: vendor-neutral RAG + chat architecture (Python/FastAPI)

## Context

This is an explicit, user-approved **phase jump**, the same kind ADR 0009 made for the analytics pipeline. CLAUDE.md's Build order puts Shopper AI / Merchant Copilot under **Phase 3**, while the project is documented as mid-Phase-1 with parts of Phase 2 (refunds, inventory reservation, search) still open. The user supplied an exhaustive, deliberate spec for the AI service anyway — read as the same kind of scoped pull-forward as 0009, recorded here per the project's own convention rather than silently overwriting the phasing rule. `apps/ai-service` already existed as a named Phase-3 placeholder (`README.md`: "Shopper AI + Merchant Copilot service. Phase 3, not yet implemented") — this ADR is that placeholder becoming real.

The ask: a standalone Python/FastAPI service providing document ingestion + RAG retrieval + LLM chat + (later) tool-calling against store data, architected so **no application code is coupled to a specific LLM vendor, embedding vendor, vector database, reranker, tool protocol (MCP), or model-routing strategy** — every one of those must be swappable behind an interface without touching `application/`.

Scope of this ADR/implementation is **Phase 1 only** (per the spec's own section 31): health, document upload → async parse/chunk/embed/index, vector retrieval, context construction, single-provider LLM chat, tenant isolation, Redis, structured logging, tests. Reranking, hybrid search, model routing, multiple providers, Qdrant, MCP/tools, streaming, citations, and the evaluation framework are built as **real interfaces with Phase 1 wiring but no second implementation** — exactly what the spec's own Phase 2/3 split asks for: the seams exist now, the vendors don't yet.

## Layered architecture

```
api/            FastAPI routers — HTTP/auth/validation only, no business logic
application/    Use-case orchestration (chat, RAG pipeline, ingestion) — depends only on domain/interfaces
domain/         Pydantic models + Protocol interfaces — no I/O, no vendor imports
infrastructure/ Vendor adapters implementing domain/interfaces — the ONLY place a vendor SDK is imported
```

`application/` and `api/` never import anything under `infrastructure/` directly — they receive already-constructed interface implementations via FastAPI's dependency-injection system (`api/dependencies.py`), which reads `config.py` (env-driven) to decide which concrete adapter to build. This mirrors core-api's own `PaymentProvider`/`OtpProvider`/`S3Service` swap-seam pattern (CLAUDE.md bugs #15, #20) — same idea, expressed as Python `Protocol`s instead of TypeScript interfaces, and FastAPI `Depends()` instead of Nest's DI container.

## Multi-tenancy: reusing the existing trust boundary, not inventing a new one

This service is **never hit directly by a browser** in Phase 1 (no UI wiring yet) — but the auth design is fixed now because retrofitting tenant isolation later is exactly the mistake CLAUDE.md's tenancy ADR (0003) warns against.

`apps/analytics` already establishes the precedent for "a second backend service that must trust core-api's own auth without importing core-api's code": `StaffJwtGuard` independently verifies the same `fk_access_token` cookie against the shared `JWT_SECRET`, and `@CurrentTenant()` reads `tenantId` **only** from that verified payload — no endpoint anywhere accepts a `tenantId` the caller supplies. This service does the same: `api/dependencies.py`'s `get_current_actor()` verifies `fk_access_token` (staff) or `fk_customer_access_token` (customer) against the shared secrets (`JWT_SECRET`/`CUSTOMER_JWT_SECRET`, read from env — never re-derived, never hardcoded), and every application-layer call signature takes `tenant_id` as an explicit parameter sourced from that verified actor, never from a request body field. The LLM is never given tenant selection power — tool arguments are validated against the authenticated actor's own tenant before any tool executes (see Tool security, Phase 2/3).

Two consequences of "verify the same cookie, don't mint a new auth surface": (1) no new JWT secret, no new login flow — one less auth surface to keep isolated, consistent with CLAUDE.md's "three separate auth surfaces" principle (this deliberately isn't a fourth; it rides on the two that already exist for browsers, staff and customer); (2) when this does get wired into the frontends, merchant-admin can call it directly cross-origin with `credentials: "include"` (same as it does for `apps/analytics` — fixed dev ports survive `SameSite=Lax`), but the storefront **must** proxy through its own same-origin rewrite, exactly as it already does for core-api, because storefront is subdomain-per-tenant and a direct cross-site cookie send is the documented failure mode in `storefront/next.config.ts`. Recorded here so nobody re-discovers that the hard way when wiring Shopper AI into the storefront later.

## PostgreSQL + pgvector

**New least-privilege role, not a reuse of `folkshops_app`.** Rather than granting the Node app's role access to AI tables (or vice versa), a new `folkshops_ai` role (`NOSUPERUSER NOBYPASSRLS`, same posture as `folkshops_app`/`folkshops_debezium`) is granted only on this service's own four tables. This isn't just tidiness: if the AI service (which embeds untrusted document content and will eventually execute LLM-issued tool calls) is ever compromised, it should not be able to read `payments`/`orders` rows directly — it must go through the same tool-authorization path everything else does. Blast-radius containment, same reasoning CLAUDE.md's "layered, never single-mechanism" tenant-isolation rule already argues for, extended to service isolation.

**Same RLS convention as core-api** — every AI table carries `tenant_id`, RLS policies gate on `nullif(current_setting('app.tenant_id', true), '')::uuid` (CLAUDE.md bug #2 — a pooled connection's reused GUC state must fail closed, not compare against an empty string), and every query sets it via `SET LOCAL` inside the same transaction (`infrastructure/persistence/postgres.py`'s `tenant_context()`, the Python analog of `withTenantContext`). Queries go through **SQLAlchemy 2.0 (async, asyncpg driver)** — table mappings in `infrastructure/persistence/models.py`, the Python analog of core-api's Drizzle schema (originally raw asyncpg; switched 2026-10-01 for typed, refactor-safe queries, see the addendum below). Migrations are NOT Alembic — they're hand-written `.sql` files under `apps/ai-service/migrations/`, applied by a minimal tracked-filename runner (`infrastructure/persistence/postgres.py`'s `run_migrations()`), the same spirit as `database/migrations/` being hand-written SQL rather than framework-generated.

**pgvector was not installed.** `postgres:16-alpine` (the image this compose file already runs) ships no `vector` extension at all — confirmed live (`pg_available_extensions` returned zero rows for `vector`) before writing a single line of vector-store code, per CLAUDE.md's "never assume a service exists" rule. `docker-compose.yml`'s `postgres` service image changes to `pgvector/pgvector:pg16` — the official image, same Postgres 16 binaries, same data format, extension pre-built. This is additive to the same volume (no reinit, same class of change as the existing `wal_level=logical` comment already documents for a different setting); `CREATE EXTENSION IF NOT EXISTS vector` runs as this service's first migration.

**Embedding dimension is a schema-time constant, not runtime-configurable.** pgvector requires a fixed vector width per column. `embedding vector(1536)` is sized for OpenAI's `text-embedding-3-small` (the Phase 1 default). Switching to a model with a different output width is not a config toggle — it requires a new migration (new column or new table) and re-embedding every existing chunk. `EmbeddingRouter` enforces this at startup: it reads the configured provider's declared dimension and refuses to boot if it doesn't match the schema's `EMBEDDING_DIMENSIONS` constant, rather than silently corrupting the vector column.

## Document ingestion queue: Redis (`arq`), not Kafka

Rule 30 is explicit: don't reach for Kafka where synchronous-enough infrastructure already does the job, and don't build a second durable-event system when one already exists. Document ingestion is a **job**, not a **business event** — nothing outside this service needs to durably know "ingest document X" happened; it just needs to run, retry on failure, and not be lost if the worker restarts. That's exactly BullMQ's role on the Node side; `arq` is its direct analog for async Python (Redis-backed, native `asyncio`, at-least-once job execution with retry/backoff). Using Kafka for this would mean modeling a job queue on top of a log-structured event bus — solving a already-solved problem with the wrong tool, which is precisely what rule 30 warns against.

**Kafka is still used, deliberately narrower than the spec's own section 22 suggests by default.** `infrastructure/messaging/kafka.py` implements a real `KafkaEventPublisher` for `document.created`/`document.indexed`/`document.failed` (the exact three events section 22 names) using `aiokafka` against the same `folkshops.events.*`-style broker — but it is **disabled by default** (`KAFKA_EVENTS_ENABLED=false`). Nothing in the rest of the Folkshops system currently consumes an AI-service document-lifecycle event (rule 30: no abstraction without a caller). It's implemented for real, not stubbed, because it's cheap and the natural future callers are obvious (a merchant-admin "your document finished indexing" notification, or an analytics ingestion-volume panel) — but it stays off until one of those actually exists, exactly the same posture core-api's own outbox took before analytics existed to consume it.

## Provider swap-seams

| Interface | Phase 1 implementation | Config | Future |
|---|---|---|---|
| `LLMProvider` | `OpenAIProvider`, plus `FakeLLMProvider` | `LLM_PROVIDER=openai\|fake` | Anthropic, Gemini, local models |
| `EmbeddingProvider` | `OpenAIEmbeddingProvider`, plus `FakeEmbeddingProvider` | `EMBEDDING_PROVIDER=openai\|fake` | Other embedding vendors |
| `VectorStore` | `PgVectorStore` | `VECTOR_STORE=pgvector` | `QdrantVectorStore` (interface defined, `NotImplementedError` body — no Qdrant instance exists to build against yet) |
| `Reranker` | `CrossEncoderReranker` (lazy-imports `sentence-transformers` only when actually enabled) | `RERANKER_ENABLED=false` | Same interface, different model/vendor |
| `ToolProvider` | interface + `ToolRegistry` only | `TOOLS_ENABLED=false` | `InternalHttpToolAdapter` (calls core-api), `McpAdapter` |
| Model routing | `ModelRouter` — single configured model, task-based hook point, no real routing logic yet | `MODEL_ROUTER_ENABLED=false` | latency/cost/task-based selection |

**Why a `fake` provider exists for LLM/embeddings and isn't in the spec's literal file list**: no OpenAI (or other) API key is configured anywhere in this repo's env files, and the project's own established convention for exactly this situation is a real, working, no-external-dependency dev implementation — `ConsoleOtpProvider` for SMS, MinIO for S3 — never a mocked-out code path that "would work in theory." `FakeLLMProvider`/`FakeEmbeddingProvider` are deterministic (hash-based fake embeddings; template-based fake completions that echo retrieved context) so the entire ingestion → retrieval → chat pipeline can be verified end-to-end against real Postgres/Redis without a paid vendor call, and so integration tests never depend on reaching a real LLM vendor (same reasoning as payments tests mocking Razorpay's HTTP layer rather than calling the real gateway).

**Why the reranker lazy-imports its dependency**: `sentence-transformers` pulls in `torch`, a heavy dependency this service should not pay for at import time when `RERANKER_ENABLED=false` (the default). The import happens inside `CrossEncoderReranker`'s first real call, matching CLAUDE.md bug #15's lesson exactly (a provider that validates/loads its dependency eagerly in `__init__`/module scope breaks every code path, not just the one that needed it) — except here it's an import cost rather than a config-validation crash, same fix shape.

## What's deliberately not built in Phase 1

Per the spec's own section 31: reranking, hybrid/BM25 search, real model routing, a second LLM/embedding provider, Qdrant, MCP/tool execution, SSE streaming, citations in the response shape (retrieval results carry scores/ids already — surfacing them as a `citations` field is a Phase 2 API-shape change, not a new capability), and the evaluation framework beyond a scaffold with one worked example. Building these now, disabled-but-present, would be the exact "abstractions without callers" / "over-engineer the first implementation" rule 30 prohibits — the interfaces exist so adding them later never touches `application/`, which is the actual requirement.

## Failure modes / resilience

- **Embedding provider down mid-ingestion**: the ingestion job fails, the document row moves to `failed` with a stored error, `arq`'s retry/backoff re-attempts the job later (idempotent — see below). The API caller already got a 202 long before this; failure is only visible via `GET /documents/{id}`'s status.
- **Reranker fails** (when enabled): retrieval continues unreranked — `rag/pipeline.py` treats the reranker call as best-effort, logs and proceeds with the original vector-similarity order, never fails the whole request over a reranking error.
- **Redis down**: rate limiting and job dispatch degrade, never take down request handling for anything that doesn't strictly need them — same fail-open posture as `RedisThrottlerStorage`/`CacheService` on the Node side.
- **Ingestion idempotency**: `document_worker`/`embedding_worker` jobs are keyed by `document_id`; both parse+chunk and embed+index steps are safe to re-run (chunk rows are replaced wholesale per document, not appended) so a retried job after a partial failure never double-inserts.

## Files

New: `apps/ai-service/**` (full service — see the implementation for the exact tree), `database` role wiring in `docker-compose.yml`/`database/init/`. Modified: `docker-compose.yml` (Postgres image swap + new `ai-service` optional compose entry, same "native `pnpm`/`uvicorn` dev, optional container" posture as `core-api`), root `README.md` (local dev section). No existing core-api/workers/analytics business logic is touched — this ADR adds a new, isolated service and a Postgres role; it does not modify the outbox, RLS policies, or any existing table.


## Addendum (2026-10-01): raw asyncpg → SQLAlchemy 2.0

Every query (`DocumentService`, `ChatService`, `PgVectorStore`, the re-embed worker) moved from raw SQL strings to SQLAlchemy 2.0's async ORM/Core. Raw SQL strings meant a misspelled column only failed at runtime; mapped columns fail at import/type-check time, and pgvector's `Vector` type gives `.cosine_distance()` instead of a hand-written `<=>`.

- **`Db.tenant_context()` keeps its contract** — still `set_config('app.tenant_id', ..., true)` inside one transaction, it just yields an `AsyncSession` instead of an asyncpg connection. RLS is unchanged and still the real isolation boundary (the tenant-isolation integration tests pass unmodified).
- **Migrations stay hand-written SQL, not Alembic.** RLS policies, GRANTs and the ivfflat index can't be expressed as models, so autogenerate couldn't produce them. Trade-off: `models.py` must be updated by hand alongside any new migration.
- **No `pgvector.asyncpg.register_vector()`** any more — `pgvector.sqlalchemy.Vector` serializes vectors itself, and registering the asyncpg codec on top makes them conflict (`invalid input for query argument`, caught by the integration suite).
- `expire_on_commit=False` on the session factory — async sessions can't lazily reload an attribute after commit.


## Addendum: plan-gated Store Copilot + knowledge base in merchant-admin (2026-10-01)

The RAG pipeline now has its first real UI. merchant-admin has a **Knowledge base** page (`/knowledge`) for uploading, listing, filtering and deleting documents, and the floating **Store Copilot** chat calls `POST /chat` and shows the source filenames for each answer. Access is gated by the store's subscription plan.

**Who can use it.** Every route except `/health` and `/entitlement` goes through `require_ai_access` (`api/dependencies.py`), which checks two things:
1. **Staff only** (`get_current_staff`). A customer token gets 403 from every route. Customers could previously upload into, and chat against, a store's knowledge base; that was a hole with no caller. The storefront Shopper Agent will be a separate surface.
2. **Plan entitlement** (`application/entitlements.py`). Allowed when `plans.ai_access` is true and `subscriptions.status` is `active` or `past_due`. Otherwise the route returns **402** with `{detail: {code, message}}`, where `code` is one of `not_in_plan`, `subscription_inactive` or `no_subscription`, so the UI can tell "upgrade your plan" apart from "finish paying".

**Why the plan check reads the database, not core-api over HTTP.** `migrations/0002` gives `folkshops_ai` column-level `SELECT` on `subscriptions(tenant_id, plan_id, status)` and `plans(id, slug, name, ai_access)` only. It can't see Stripe ids or prices. The read is one indexed query under the same RLS tenant context as everything else here. An HTTP call would mean forwarding the tenant (core-api resolves it from the hostname in production) and adding a second failure point. Nothing is cached, so an upgrade or downgrade applies on the very next request. This is the first coupling from this service to core-api's schema (its own tables still have no FKs to `tenants`). The grants live in this service's migrations because they're this role's grants, matching how 0001 scopes it.

**`GET /entitlement`** (staff only, deliberately not gated) is what merchant-admin reads to choose between the real UI and an upgrade prompt. That choice is cosmetic. Enforcement is server-side on every request.

**Other changes in this slice:**
- `GET /documents` is now paginated, sortable and filterable, returning `{data,total,page,limit,totalPages}` so DataTable can drive it.
- New `DELETE /documents/{id}`, a hard delete (chunks cascade). Removing a document has to remove it from retrieval.
- An ingestion job for a document deleted before the job ran exits cleanly instead of retrying.
- Citations now carry `filename`.
- `get_current_actor` is `async` and binds `tenant_id`/`actor_id` into structlog's context.
- `docker-compose.yml` gains an `ai-worker` service (same image, `arq` command). Without it, uploads never leave `uploaded`.

**Still not built:** streaming, multi-turn context (each `/chat` call sends only the latest message to the LLM; turns are stored but not replayed), per-plan document or storage quotas, and a minimum retrieval score (every top-k chunk is cited, however weakly it matched).


## Addendum: local embeddings, vector(384) (2026-10-01)

**What changed.** Embeddings are now produced locally by default: `EMBEDDING_PROVIDER=local` runs **`BAAI/bge-small-en-v1.5`** inside ai-service and ai-worker via sentence-transformers (`infrastructure/embeddings/local.py`). It needs no API key, and the ~130MB model downloads once into the `ai-model-cache` compose volume (`HF_HOME=/models`). Retrieval is now semantic: in a live test, "Can I send a jacket back if it doesn't fit?" ranked a returns passage (0.594) above a shipping passage (0.467) with no shared words. `tests/unit/test_local_embeddings.py` checks the same thing against the real model. The chat model is still `LLM_PROVIDER=fake`.

**Schema.** `migrations/0003` changes `document_chunks.embedding` from `vector(1536)` to `vector(384)`, the model's native width. This was chosen over zero-padding to 1536. The trade-off: going back to OpenAI (1536) needs another migration, or OpenAI's `dimensions=384` request parameter, which `OpenAIEmbeddingProvider` doesn't pass yet. Existing vectors are cleared rather than converted, since a vector from one model means nothing to another. Chunk text is kept, and `scripts/reembed_all.py` queues the existing `reembed_document` job for each document (run it inside the ai-worker container; see its docstring). Search now skips chunks whose `embedding IS NULL`.

**Index.** Changed from IVFFlat to **HNSW**. IVFFlat learns its centroids from the rows present when the index is built, and 0001 built it on an empty table, so recall was poor. HNSW has no training step.

**Loading.**
- Selecting the provider never loads the model. Its width comes from a fixed table, so the startup schema check stays instant.
- The model is warmed up in a **background task** at startup, never awaited inline. The first build awaited it, and a first-run download held startup past the container healthcheck, so `ai-worker`'s `depends_on` failed.
- Inference runs in a thread (`asyncio.to_thread`), so a large document doesn't block the event loop.
- BGE's query instruction prefix is applied to queries only, not documents.

**Image.** The Dockerfile pre-installs CPU-only torch from PyTorch's CPU index; PyPI's default Linux x86 wheel bundles CUDA. The image is still ~3.8GB, up from ~0.9GB, mostly torch plus transformers. `sentence-transformers` moved into `requirements.txt`, and `requirements-reranker.txt` was removed.
