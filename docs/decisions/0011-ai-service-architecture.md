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

**Same RLS convention as core-api** — every AI table carries `tenant_id`, RLS policies gate on `nullif(current_setting('app.tenant_id', true), '')::uuid` (CLAUDE.md bug #2 — a pooled connection's reused GUC state must fail closed, not compare against an empty string), and every query sets it via `SET LOCAL` inside the same transaction (`infrastructure/persistence/postgres.py`'s `tenant_context()`, the Python analog of `withTenantContext`). One departure from the Node convention: `asyncpg` has no ORM/migration tool in this stack (matching core-api's own choice of raw `pg.Pool` over an ORM) — migrations are hand-written `.sql` files under `apps/ai-service/migrations/`, applied by a minimal tracked-filename runner (`infrastructure/persistence/postgres.py`'s `run_migrations()`), the same spirit as `database/migrations/` being hand-written SQL rather than framework-generated.

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
