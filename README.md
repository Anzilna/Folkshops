# folkshops-app

India-first, multi-tenant e-commerce SaaS platform. This is the application monorepo — see `docs/decisions/` for why the stack looks the way it does, and the project's master build order for what comes next.

## Status

Phase 1 (Foundation) is in progress. Currently working:

- Monorepo tooling (pnpm workspaces + Turborepo).
- `apps/core-api` — NestJS, boots, connects to Postgres via Drizzle, exposes `GET /health`.
- Tenancy + auth + RBAC + Row-Level Security: `POST /auth/register` (self-service store signup), `POST /auth/login`, `GET /auth/me`. See `docs/decisions/0003-tenancy-rls.md`.
- Products: `GET /products`, `GET /products/:id` (public, tenant-scoped), `POST`/`PATCH`/`DELETE /products` (authenticated members only). RLS-protected like every other tenant-owned table.
- Primary/replica-ready database routing (`DbRouter`) — `write()` / `read("strong"|"eventual")`, with fallback-to-primary if a replica read fails. No real replica exists yet (local/CI point both logical connections at one Postgres, on purpose) — see `docs/decisions/0005-primary-replica-routing.md`.
- `database/rls-tests` — mandatory concurrent RLS isolation test, run directly against Postgres, now including primary+replica routing.
- CI (`.github/workflows/ci.yml`) runs the full test suite (not just lint/build) against a temporary Postgres service container.

Everything else under `apps/` and `packages/` is a placeholder (see each one's README) — scaffolded shape, no implementation yet.

## Prerequisites

- Node.js >= 20 (repo pins 24 via `.nvmrc`)
- pnpm >= 9
- Docker (for local Postgres/Redis — optionally `core-api` too, see below)

## Local development

```bash
# 1. Install dependencies
pnpm install

# 2. Start local Postgres + Redis
docker compose up -d

# 3. Configure core-api
cp apps/core-api/.env.example apps/core-api/.env

# 4. Apply database migrations (uses the schema-owning role)
pnpm --filter @folkshops/core-api db:migrate

# 5. Run core-api (connects as the least-privilege app role)
pnpm --filter @folkshops/core-api dev

# 6. Verify
curl http://localhost:4000/health
# -> {"status":"ok","db":"connected"}

# 7. Run tests (DbRouter unit tests + the mandatory RLS isolation suite,
#    now covering both the primary and replica connection paths)
pnpm test
```

`.env.example` sets `DATABASE_PRIMARY_URL` and `DATABASE_REPLICA_URL` to the **same** local Postgres — there is no real replica locally or in CI, only the routing code. See `docs/decisions/0005-primary-replica-routing.md`.

### Running core-api in Docker instead (optional)

Steps 4–5 above can run inside Docker instead, if you'd rather not use a
separate terminal for `core-api`:

```bash
docker compose up -d --build core-api
```

This builds and runs core-api alongside Postgres/Redis, applying pending
migrations automatically on startup, and hot-reloads via a bind mount — no
rebuild needed after editing source. `apps/core-api/.env` is not used here;
the container gets its config from `docker-compose.yml`'s `environment:`
block instead (using container-network hostnames like `postgres`/`redis`
rather than `localhost`). Native `pnpm --filter @folkshops/core-api dev`
keeps working exactly as before and is unaffected by this — don't run both
at once, they'd fight over port 4000.

The four Next.js frontends are **not** containerized — run them natively
(`pnpm --filter <app-name> dev`), each on its fixed local port:
`storefront`:3000, `merchant-admin`:3001, `platform-admin`:3002,
`marketing`:3003.

## Analytics stack (Kafka + Debezium + Elasticsearch)

A deliberate, user-approved pull-forward of later-phase infrastructure —
see `docs/decisions/0009-analytics-outbox-cdc-kafka.md` for why both the
transactional outbox and Debezium CDC exist and land in Kafka, consumed by
a separate `apps/analytics` service. Not part of the default `docker
compose up -d` mental model above conceptually (it's the same command),
but new enough to call out its own startup order and health checks.

```bash
# 1. Bring up every service, including the new ones — depends_on/health
#    checks already express the correct order (postgres -> kafka ->
#    kafka-init -> kafka-connect -> debezium-connector-init;
#    elasticsearch independent):
docker compose up -d

# 2. Apply migrations (creates the folkshops_debezium role, grants, and
#    the CDC publication — 0025/0026 in database/migrations/):
pnpm --filter @folkshops/core-api db:migrate

# 3. Health checks
curl http://localhost:8083/connectors/folkshops-postgres-connector/status
# -> {"name":"folkshops-postgres-connector","connector":{"state":"RUNNING",...},"tasks":[{"state":"RUNNING",...}]}
curl http://localhost:9200/_cluster/health
# -> {"status":"green" or "yellow", ...} (yellow is normal for a single dev node — see index mappings' number_of_replicas: 0)

# 4. Build the shared event-envelope package once (apps/workers and
#    apps/analytics both consume its compiled output, not raw TS):
pnpm --filter @folkshops/events build

# 5. Run the analytics service natively (not a compose service, same
#    precedent as apps/workers):
cp apps/analytics/.env.example apps/analytics/.env
pnpm --filter @folkshops/analytics-api dev
curl http://localhost:4100/health
# -> {"status":"ok"}

# 6. apps/workers also needs the new KAFKA_BROKERS var — copy/update its .env
#    (see apps/workers/.env.example) and restart it if already running.
```

**Kafka topics**: `folkshops.events.order` / `folkshops.events.payment` /
`folkshops.events.cart` (business events, from the outbox relay) and
`folkshops.cdc.products` / `folkshops.cdc.categories` (raw Debezium
change events) — created up front by the `kafka-init` one-shot service.

**Verify a business event end to end**: complete a real Stripe test-mode
checkout (`docs/payments.md`), then:
```bash
curl -s http://localhost:9200/order_analytics/_search?pretty
```
should show a document for that order; the merchant-admin `/analytics`
page (subscribed via SSE) should update live without a reload.

**Verify a CDC event end to end**: edit a product's name via
merchant-admin, then:
```bash
curl -s http://localhost:9200/products/_doc/product:<tenantId>:<productId>
```
should reflect the new name within a few seconds.

**Elasticsearch indexes**: `products` / `categories` / `order_analytics`
are aliases — the real, versioned indexes behind them (`products_v1`,
etc.) are never referenced directly by the application; see
`apps/analytics/src/search/alias-manager.service.ts`.

**Re-registering the Debezium connector by hand** (if it's ever deleted
or `docker compose down -v` wiped it):
```bash
curl -X PUT http://localhost:8083/connectors/folkshops-postgres-connector/config \
  -H 'Content-Type: application/json' \
  -d @database/debezium/postgres-connector.json
```

**If the connector is down for a long time**: the replication slot
(`folkshops_cdc_slot`) retains WAL up to `max_slot_wal_keep_size=2GB`
(set on the `postgres` service) — past that, the slot becomes invalid and
needs a full re-snapshot (`snapshot.mode: initial` re-registration). Not
a concern for normal dev use, just don't leave `docker compose stop`
running for days with a stuck connector.

## Repository layout

```
apps/            deployable applications (Next.js frontends, NestJS core-api, ai-service, workers)
packages/        shared build-time packages (ui, api-client, types, validation, config, analytics, tool-contracts)
database/        SQL migrations, seeds, functions, RLS isolation tests
docs/            architecture and decision records
```

Infrastructure (Terraform/Helm/Argo CD) lives in a separate `folkshops-infra` repository, not here.
