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

## Repository layout

```
apps/            deployable applications (Next.js frontends, NestJS core-api, ai-service, workers)
packages/        shared build-time packages (ui, api-client, types, validation, config, analytics, tool-contracts)
database/        SQL migrations, seeds, functions, RLS isolation tests
docs/            architecture and decision records
```

Infrastructure (Terraform/Helm/Argo CD) lives in a separate `folkshops-infra` repository, not here.
