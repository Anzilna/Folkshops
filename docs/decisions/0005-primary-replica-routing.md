# 0005 — Primary/replica-ready database routing

## Context

Production will eventually use an RDS primary plus an optional RDS Read Replica for read scaling. Rather than retrofit every call site later, the application's database access is restructured now so read/write routing is a first-class, centralized decision — while explicitly not standing up any real replication infrastructure yet (no second Docker container, no RDS Read Replica, no streaming replication). This is application-architecture readiness, not infrastructure.

## What "primary" and "replica" mean here

- **Primary**: source of truth. All writes. All reads where the latest committed data matters (auth, payment status, inventory, anything just written and immediately read back).
- **Replica**: read-only, eventually consistent. Intended for stale-tolerant reads (catalog browsing, reporting) that can be offloaded from primary. **Never** a write target — there is no code path that can write through it.

## The abstraction: `DbRouter`

`apps/core-api/src/database/db-router.ts` is the one place business logic asks for a database connection:

```ts
dbRouter.write(fn)                    // always primary
dbRouter.read("strong", fn)           // always primary
dbRouter.read("eventual", fn)         // replica, falls back to primary on failure
```

Routing (which physical connection) is deliberately kept separate from tenant isolation (which rows on that connection) — they compose, rather than one absorbing the other:
```ts
dbRouter.write((db) => withTenantContext(db, tenantId, (tx) => tx.insert(...)))
```
`withTenantContext` (unchanged from before this work) doesn't know or care which pool `db` came from — it already worked on "whatever `Db` it's handed," which is exactly why adding a second pool required zero changes to the RLS mechanism itself.

```
                    ┌─────────────┐
   business logic → │  DbRouter   │
                    └──────┬──────┘
                write()    │    read("strong")     read("eventual")
                    │      │           │                   │
                    ▼      ▼           ▼                   ▼
              ┌──────────────────┐            ┌──────────────────┐
              │   PRIMARY (Db)   │◄───────────│  REPLICA (Db)    │
              │  DATABASE_       │  fallback  │  DATABASE_       │
              │  PRIMARY_URL     │  on failure│  REPLICA_URL     │
              └──────────────────┘            └──────────────────┘
                       │                                │
                       └───────────── local/CI: same Postgres ─────────┘
                                    (see below — not real replication)
```

## Local development and CI: no real replication, and that's documented, not hidden

`DATABASE_PRIMARY_URL` and `DATABASE_REPLICA_URL` point at the **same** Postgres instance, both locally and in CI:
```
DATABASE_PRIMARY_URL=postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev
DATABASE_REPLICA_URL=postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev
```
This is two independent `pg.Pool` objects dialing the same server — real connections, real queries, zero mocking — but **not** real replication. There is no second Postgres container, no streaming replication, no replication lag to observe. A query through `read("eventual", ...)` and one through `read("strong", ...)` will always see identical data locally, because they're the same database. Do not read anything into that beyond "the routing code works"; it says nothing about how a real replica would behave under lag.

CI (`.github/workflows/ci.yml`) follows the identical pattern with one temporary `postgres:16-alpine` service container — no AWS dependency, no real replica, ever.

## Why the app role has to be bootstrapped, not initialized, in CI

Local Docker Compose auto-creates `folkshops_app` via `database/init/01-app-role.sql` (Postgres's `docker-entrypoint-initdb.d` hook, fresh-volume only). GitHub Actions' `services:` containers start **before** `actions/checkout` runs, so that SQL file isn't on disk yet when the container boots — mounting it in isn't possible the way Compose does it. CI instead runs `apps/core-api/scripts/bootstrap-app-role.ts` (the same script written for RDS in `0004-rds-dev-database.md`) as an ordinary step, after checkout. One script now covers both "a Postgres with no init-hook" cases — RDS and CI — rather than two separate mechanisms.

## Production (future, not built yet)

```
DATABASE_PRIMARY_URL -> RDS PostgreSQL Primary endpoint
DATABASE_REPLICA_URL -> RDS PostgreSQL Read Replica endpoint (once one exists)
```
Until a real Read Replica exists, `DATABASE_REPLICA_URL` in any AWS environment should point at the **primary's** endpoint — same rule as local/CI: no pretending, just document it. No RDS Read Replica Terraform is written as part of this work; that's explicitly out of scope until requested.

**Multi-AZ is a separate concern, kept separate on purpose.** Multi-AZ is AWS-managed failover — the application keeps using the same RDS endpoint, no application code is involved, no `DbRouter` change is needed. A Read Replica is a distinct AWS resource with its own endpoint, asynchronous replication, and possible lag — `DbRouter` is what decides which reads may tolerate that lag. Conflating the two would misattribute an AWS-managed availability feature to an application-level routing decision.

## What's verified vs. not

**Verified live, this session, against real Postgres:**
- `DbRouter` unit tests (`apps/core-api/src/database/db-router.spec.ts`) — write→primary, strong-read→primary, eventual-read→replica, eventual-read fallback→primary, fallback doesn't mask a primary-side failure.
- RLS isolation through both the primary and replica connection paths, including the concurrent cross-tenant test and the fail-closed (no context set) test (`database/rls-tests/primary-replica-routing.rls.test.ts`).
- The full auth flow (`register`/`login`) end-to-end through `DbRouter` against real Postgres.
- The entire CI recipe (bootstrap-app-role → migrate → test) against a **freshly created**, un-initialized Postgres container standing in for GitHub Actions' service container — not assumed, actually run.
- Fixed a live bug found while doing this work: local `.env` had `DATABASE_URL` pointing at the `folkshops` superuser role (RLS-bypass), inherited from before the primary/replica split. Corrected to `folkshops_app` for both `DATABASE_PRIMARY_URL` and `DATABASE_REPLICA_URL`.

**Not verified, and not claimed:**
- Actual PostgreSQL streaming replication, replication lag, or a real RDS Read Replica's failure modes. None of that exists yet to test against. The "eventual read falls back to primary on failure" path is proven at the routing-logic level (a callback that throws triggers fallback) — it has not been exercised against a real replica actually going unavailable, because there is no real replica.
- The RDS `DATABASE_SSL=true` path in this context — see `0004-rds-dev-database.md`, unchanged by this work.
