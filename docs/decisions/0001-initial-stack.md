# 0001 — Initial monorepo stack

## Context

First slice of Phase 1: a monorepo skeleton matching the target `apps/` / `packages/` / `database/` layout, plus one real, working piece — the Core API booting and connecting to Postgres — to prove the toolchain before any business logic is built.

## Decisions

**pnpm workspaces + Turborepo.** pnpm gives strict, deduplicated node_modules (no phantom dependencies between apps/packages) and is the workspace manager the target layout was designed around. Turborepo adds task orchestration and caching (`turbo run build` builds only what changed, in dependency order) across ~13 apps/packages — without it, every `pnpm -r` command runs everything, unordered. Both are configuration, not runtime dependencies of any shipped service, so there is no production blast radius from choosing them.

**NestJS for Core API.** Already specified by the master architecture (module-per-domain matches the planned `auth/ tenants/ products/ ...` structure); no alternative was evaluated for this slice.

**Raw `pg` Pool instead of an ORM, for now.** The next slice (tenancy) requires `BEGIN; SET LOCAL app.tenant_id = ...; ... COMMIT;` — the tenant context must be set and reset on one checked-out client within one transaction, never leaking across pooled connections. That requires direct control over transaction and connection lifecycle. Prisma's query engine pools and reuses connections in ways that fight this pattern; TypeORM makes it possible but awkward. Using `pg` directly now means the health check and the future RLS transaction wrapper both sit on the same, fully-controlled connection model — no rework when tenancy lands. A typed query builder (e.g. Kysely) may be layered on top of this same pool later; that is a typing convenience, not a transaction-lifecycle change, so it does not conflict with this decision.

**Postgres + Redis in `docker-compose.yml`, nothing else yet.** These are the only two datastores Phase 1 features need. Elasticsearch, Kafka, and Debezium are explicitly later-phase (search, event streaming, CDC) and are not started until the features that need them exist — running them idle from day one would be infrastructure for appearance, not need.

**Placeholder `package.json` + README for every other app/package.** Keeps the pnpm workspace list accurate (every planned app appears in `pnpm -r list`) without inventing empty implementations. Each README states its phase so it's clear what's real.

## What this slice deliberately does not include

- Auth, tenancy, RBAC, RLS — next slice; `database/rls-tests/` stays empty until then, and no tenant-facing feature is allowed before its concurrent isolation test exists (see repo root README build order).
- Any frontend app beyond its placeholder — Next.js scaffolding is a separate slice per app.
- CI beyond lint/build — no deploy pipeline until there is something worth deploying.
