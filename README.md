# folkshops-app

India-first, multi-tenant e-commerce SaaS platform. This is the application monorepo — see `docs/decisions/` for why the stack looks the way it does, and the project's master build order for what comes next.

## Status

Phase 1 (Foundation) is in progress. Currently working:

- Monorepo tooling (pnpm workspaces + Turborepo).
- `apps/core-api` — NestJS, boots, connects to Postgres via Drizzle, exposes `GET /health`.
- Tenancy + auth + RBAC + Row-Level Security: `POST /auth/register` (self-service store signup), `POST /auth/login`, `GET /auth/me`. See `docs/decisions/0003-tenancy-rls.md`.
- `database/rls-tests` — mandatory concurrent RLS isolation test, run directly against Postgres.

Everything else under `apps/` and `packages/` is a placeholder (see each one's README) — scaffolded shape, no implementation yet.

## Prerequisites

- Node.js >= 20 (repo pins 24 via `.nvmrc`)
- pnpm >= 9
- Docker (for local Postgres/Redis)

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

# 7. Run the mandatory RLS isolation test
pnpm --filter @folkshops/rls-tests test
```

## Repository layout

```
apps/            deployable applications (Next.js frontends, NestJS core-api, ai-service, workers)
packages/        shared build-time packages (ui, api-client, types, validation, config, analytics, tool-contracts)
database/        SQL migrations, seeds, functions, RLS isolation tests
docs/            architecture and decision records
```

Infrastructure (Terraform/Helm/Argo CD) lives in a separate `folkshops-infra` repository, not here.
