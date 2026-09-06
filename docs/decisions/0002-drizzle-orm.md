# 0002 — Drizzle as the query layer

## Context

[0001](0001-initial-stack.md) chose a raw `pg` Pool over an ORM specifically because the upcoming RLS pattern (`BEGIN; SET LOCAL app.tenant_id = ...; ...; COMMIT;`) needs explicit control over a single checked-out client for the duration of one transaction, and flagged that "a typed query builder ... may be layered on top of this same pool later." Core API now needs that query layer.

## What it is / what problem it solves

Drizzle is a TypeScript query builder: you define tables as plain TS objects, get fully-typed query methods (`db.select().from(products).where(...)`), and its CLI (`drizzle-kit`) diffs your schema against the previous state to generate plain `.sql` migration files. It solves two problems raw `pg` leaves unaddressed: hand-written SQL strings have no compile-time check against the actual table shape, and hand-written migrations drift from the schema they're meant to produce.

## Why Drizzle instead of Prisma (the more common default)

Prisma's query engine owns connection pooling itself and historically has made transaction-scoped session state (`SET LOCAL`) awkward to guarantee on one physical connection. Drizzle's `node-postgres` driver is a thin wrapper over a `pg.Pool`/`Client` you provide — `db.transaction(async (tx) => { await tx.execute(sql\`SET LOCAL app.tenant_id = ${id}\`); ... })` runs entirely on one checked-out client, which is exactly the guarantee rule 8 requires. This is not a hypothetical: it's the documented pattern Drizzle itself recommends for Postgres RLS.

## Where it sits / how it communicates

`DatabaseModule` (`apps/core-api/src/database/database.module.ts`) still owns the `pg.Pool` (`PG_POOL`) — unchanged from 0001, error-handling included. A new `DRIZZLE` provider wraps that same pool: `drizzle(pool, { schema })`. Nothing else in the app talks to `pg` directly; application code depends on `DRIZZLE`. Migrations are generated from `src/database/schema.ts` via `drizzle-kit generate` and land as plain SQL in the repo's existing `database/migrations/` (see that folder's README) — the directory structure from the master architecture didn't need to change, only what populates it.

## What happens if it fails

Drizzle adds no runtime process of its own — it's a library call inside the same Node process as Core API, so its failure modes are the pool's failure modes (already handled: idle-client errors are logged, not fatal, per 0001's fix). `drizzle-kit` (the CLI) only runs at migration-authoring/deploy time, never in the request path — a `drizzle-kit` bug can't take down a running Core API.

## Scaling / required now vs. later

No scaling implications beyond the underlying `pg.Pool`'s own (pool size, RDS connection limits — a later-phase concern). Required now: this is the query layer every subsequent Core API module (tenants, products, orders, ...) will be built on, so it needs to be right before schema work starts, not retrofitted after.
