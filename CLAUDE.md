# Folkshops — project context for Claude

India-first, multi-tenant e-commerce SaaS platform (Shopify-like). This file exists so a **new chat session starting cold in this repo has full context** without the user re-explaining the project. Read this before doing anything else here.

## Governing principles (from the original master spec)

- **Build in phases, incrementally.** Don't implement a later phase's tech (Kafka, Debezium, advanced AI, K8s autoscaling, custom domains, etc.) before its dependencies exist. See "Build order" below.
- **Explain before implementing.** For any new technology/component: what it is, what problem it solves, why Folkshops needs it now (not later), what alternative was passed over, where it sits architecturally, what happens if it fails, how it scales.
- Every technology must have a concrete reason. Never add something to look sophisticated.
- **Tenant isolation is layered, never single-mechanism**: authentication → membership → RBAC → tenant resolution → PostgreSQL RLS. Never rely on application code alone.
- Before modifying existing code: inspect what's actually there. Never assume a file/table/env var/service exists.
- Two repos: `folkshops-app` (this repo — frontends, backend, migrations, tests) and a separate `folkshops-infra` (Terraform/Helm/Argo CD) — not created yet, out of scope until Phase 6.
- Don't add features, abstractions, or guards that have no caller yet (see "Deliberately deferred" below) — but don't leave things half-finished either.

## Repository layout

```
apps/            marketing, storefront, merchant-admin, platform-admin (Next.js, all placeholders so far),
                 core-api (NestJS — the only service that touches Postgres), ai-service, workers (placeholders)
packages/        shared build-time packages (ui, api-client, types, validation, config, analytics, tool-contracts) — all placeholders
database/        migrations/ (Drizzle-generated + hand-written SQL), init/ (Postgres bootstrap), rls-tests/ (standalone test package), seeds/, functions/
docs/decisions/  numbered ADRs — read these for the "why" behind every non-obvious choice
```

Root `README.md` has the up-to-date local dev setup commands. Follow it, don't re-derive it.

## Current status (as of Phase 1 foundation)

**Built and verified live** (not just written — booted against real Postgres, curl-tested, or run as an actual test suite):

- Monorepo: pnpm workspaces + Turborepo.
- `apps/core-api`: NestJS, boots, `GET /health` (checks real DB connectivity via Drizzle).
- Drizzle ORM on top of a raw `pg.Pool` (not Prisma — see `docs/decisions/0002-drizzle-orm.md`; Prisma's pooled query engine fights the transaction-scoped `SET LOCAL` RLS pattern).
- Tenancy + auth + RBAC + RLS (`docs/decisions/0003-tenancy-rls.md`): `tenants`/`users`/`memberships` schema, `POST /auth/register` (self-service store signup), `POST /auth/login`, `GET /auth/me`. RLS enforced on `memberships` (the first genuinely tenant-owned table).
- Primary/replica-ready DB routing (`docs/decisions/0005-primary-replica-routing.md`): `DbRouter.write()` / `.read("strong"|"eventual")`, centralizing which pool business logic talks to. **No real replica exists** — `DATABASE_PRIMARY_URL`/`DATABASE_REPLICA_URL` point at the same Postgres locally and in CI, deliberately, documented as such. All existing services (`TenantsService`, `UsersService`, `HealthController`, `AuthService`) go through it now, not raw `DRIZZLE` injection.
- `apps/core-api`'s `products` module: `products` schema (tenant-owned, RLS-protected — `priceCents` as integer, not decimal/float). `GET /products` and `GET /products/:id` are public (tenant-scoped, no auth — real storefronts let anyone browse), `POST`/`PATCH`/`DELETE` require an authenticated member of that tenant (any role). `list()` uses `read("eventual")`, `findById()` uses `read("strong")` — see `products.service.ts` for why. First real consumer of `DbRouter`'s eventual-read path outside a test.
- `database/rls-tests`: mandatory concurrent RLS isolation test package — runs directly against Postgres as the app's actual runtime role, not through the app. Now also proves RLS holds identically through both the primary and replica connection paths, and for `products` in addition to `memberships`.
- CI (`.github/workflows/ci.yml`) runs a real Postgres service container, bootstraps the app role, migrates, and runs the full test suite — previously it only ran lint+build with no DB at all.

**Everything else under `apps/` and `packages/`** is an intentional placeholder: real `package.json` + README stating its phase, no implementation. Don't assume any frontend app, `ai-service`, or `workers` does anything yet.

## Real bugs found (know these before touching auth/RLS/guards again)

Full detail in `docs/decisions/0003-tenancy-rls.md`. Short version, because these are easy to reintroduce:

1. **The Postgres role must never be a superuser.** `POSTGRES_USER` in the official Docker image is a bootstrap superuser, and RLS — even `FORCE ROW LEVEL SECURITY` — has zero effect on a superuser or any `BYPASSRLS` role. The app connects as `folkshops_app` (created by `database/init/01-app-role.sql`, non-superuser, `NOBYPASSRLS`). Migrations run as the `folkshops` owner role (`MIGRATIONS_DATABASE_URL`). **Never point `DATABASE_PRIMARY_URL` or `DATABASE_REPLICA_URL` (the app's runtime connections) at the `folkshops` superuser role** — that would silently disable every RLS policy in the system again. (This regressed once already — see `docs/decisions/0005-primary-replica-routing.md`'s "what's verified" section.)
2. **`current_setting('app.tenant_id', true)` returns `''` (empty string), not `NULL`, on any pooled connection that has previously had tenant context set** — which, in production, is essentially every connection after its first request. Any new RLS policy on a future tenant-owned table must use `nullif(current_setting('app.tenant_id', true), '')::uuid`, not a bare cast — see `database/migrations/0002_fix-rls-empty-string-guc.sql` for the pattern to copy.
3. **`AuthModule` must export `JwtModule` itself, not just `JwtAuthGuard`/`TenantMatchGuard`.** Any *other* module that imports `AuthModule` purely to use those guards (e.g. `ProductsModule`) needs `JwtService` resolvable in its own injector context too — exporting only the guard classes throws `UnknownDependenciesException` at boot the first time a guard is used outside `AuthModule` itself. Caught when `ProductsModule` became the first consumer; fixed in `auth.module.ts` by exporting the `JwtModule.registerAsync(...)` instance alongside the guards. Any future module using these guards should just work now, but if `UnknownDependenciesException` mentioning `JwtService` shows up again, this is why.

All three were caught by actually running the thing (curl attack sequences, or just booting the app), not by code review. When adding RLS to a new table, write the equivalent of `database/rls-tests/memberships.rls.test.ts` for it and actually run it — don't just inspect the policy with `\d`.

## Local dev quick reference

```bash
pnpm install
docker compose up -d                                    # Postgres + Redis (one container — no local replica)
cp apps/core-api/.env.example apps/core-api/.env
pnpm --filter @folkshops/core-api db:migrate             # schema-owner role
pnpm --filter @folkshops/core-api dev                    # app role
pnpm test                                                # DbRouter unit tests + mandatory RLS suite
```

`.env`'s `DATABASE_PRIMARY_URL`/`DATABASE_REPLICA_URL` point at the same local Postgres — no real replication locally, see `docs/decisions/0005-primary-replica-routing.md`.

Dev-only tenant resolution override: `X-Tenant-Id: <slug>` header (never honored when `NODE_ENV=production`). Production resolves tenant from the hostname subdomain (`nike.folkshops.com` → `nike`).

## Git workflow

- `main` — baseline, currently just the empty initial commit. No release-promotion policy defined yet (not asked for).
- `develop` — integration branch. **Every phase gets its own branch off `develop`, merged back into `develop` when done** (e.g. `phase-1-foundation`, already merged). Follow this pattern for each new phase — don't commit phase work directly to `develop`.
- Remote: `https://github.com/Anzilna/Folkshops.git`.
- **Never add a Claude/Anthropic co-author line to commit messages** (explicit user instruction).

## Build order (what's next)

Per the master spec's phasing — current position is mid-**Phase 1**:

1. **Phase 1 (Foundation)** — done: auth/tenancy/RBAC/RLS, core-api boot, products. Remaining: categories, inventory, cart, orders; the Next.js frontend apps still need real scaffolding (they're placeholders).
2. **Phase 2 (Commerce Hardening)** — Razorpay test integration, webhooks, idempotency, order state machine, inventory reservation, Redis, BullMQ, outbox pattern, notifications, search.
3. **Phase 3 (AI)** — Shopper Agent, Tool Registry, SSE, Merchant Copilot (coordinator + specialist agents), guardrails, MCP.
4. **Phase 4 (Analytics/Marketing)** — event tracking, campaigns, attribution, affiliates, SMS/WhatsApp/email.
5. **Phase 5 (Scale)** — Kafka, Debezium/CDC, Elasticsearch pipeline, read replicas, HPA/KEDA/Karpenter.
6. **Phase 6 (GitOps)** — separate `folkshops-infra` repo: Terraform, Helm, Argo CD.

Don't jump ahead — each phase assumes the previous one's tables/services exist.

## Deliberately deferred (not bugs, not forgotten)

- `tenant_domains` table / custom domains — nothing needs them yet (subdomain-only resolution for now).
- `RolesGuard`/`@Roles()` route-level RBAC — role data exists on `memberships` and flows into the JWT, but no route yet needs to restrict by role.
- Seed data scripts, staff invitations. `core-api` now has real unit tests (`db-router.spec.ts`) but coverage is still thin outside that — most verification is still live/manual + the RLS integration suite.
- Real RDS Read Replica / RDS Read Replica Terraform — `DbRouter` is ready for one, none exists (see `docs/decisions/0005-primary-replica-routing.md`).
