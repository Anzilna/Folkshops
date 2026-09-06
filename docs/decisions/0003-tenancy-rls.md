# 0003 — Tenancy, auth, RBAC, and RLS

## What was built

- Schema: `tenants`, `users`, `memberships` (role: owner/staff). `tenant_domains` deferred — nothing needs custom domains yet.
- RLS on `memberships` only — the first genuinely tenant-owned table. `tenants`/`users` aren't tenant-scoped by definition.
- Isolation as layered defense (rule 7), not one mechanism: JWT auth → membership verified at login → tenant resolved from hostname (dev: `X-Tenant-Id` header) → cross-checked against the JWT's tenant (`TenantMatchGuard`) → Postgres RLS as the DB-level backstop.
- `apps/core-api/src/database/tenant-context.ts`: `withTenantContext(db, tenantId, fn)` runs one Postgres transaction with `app.tenant_id` set via `set_config(..., true)` (transaction-local, parameterized — never a string-interpolated `SET LOCAL`).
- `database/rls-tests`: a standalone package that connects directly to Postgres (not through the app) as the app's actual runtime role, and concurrently exercises the policy under a small, reused connection pool.

## Two real bugs found by testing this live, not just building it

**1. The Postgres role was a superuser.** `POSTGRES_USER=folkshops` in the official Docker image is the bootstrap superuser, and RLS — `FORCE` included — has no effect on a superuser or any `BYPASSRLS` role. A cross-tenant login test (log into the Coffee store using the Nike owner's credentials) silently succeeded before this was caught: the query returned Nike's own membership row regardless of which tenant context was set, because RLS was never actually being enforced. Every earlier check that the policy and `FORCE ROW LEVEL SECURITY` existed on the table (`\d memberships`, `pg_class.relforcerowsecurity`) was necessary but not sufficient — it confirmed the policy existed, never that it did anything.

  Fix: `database/init/01-app-role.sql` creates `folkshops_app` (`NOSUPERUSER NOBYPASSRLS`) with `ALTER DEFAULT PRIVILEGES` so it automatically gets access to tables created later by migrations. The app's `DATABASE_URL` now points at `folkshops_app`; `drizzle.config.ts` keeps using the owning `folkshops` role (via `MIGRATIONS_DATABASE_URL`) for schema changes only — the running app should never hold DDL privileges.

  Defense in depth on top of the role fix: `AuthService.login` now issues the JWT's `tenantId` from the verified `membership.tenantId`, never the caller-supplied `input.tenantId` — so a future RLS misconfiguration would degrade to "login fails" rather than "a cross-tenant token gets issued."

**2. `current_setting('app.tenant_id', true)` doesn't reliably return `NULL` when unset.** True `NULL` only on a connection where that custom GUC was never touched. On a reused pooled connection that has run *any* prior tenant-scoped transaction — i.e., in production, essentially every connection after its first request — the post-commit reset value is `''` (empty string), and `''::uuid` throws rather than evaluating falsy. The original policy assumed NULL universally and would have turned "forgot to set tenant context" into a 500 in production while looking correct in a single fresh `psql` connection during manual testing.

  Fix (`database/migrations/0002_fix-rls-empty-string-guc.sql`): `nullif(current_setting('app.tenant_id', true), '')::uuid` normalizes both cases to `NULL` before the cast, so both fail closed identically (zero rows, not an error).

## Verification, not just code review

- `database/rls-tests` run for real against local Postgres: pass as `folkshops_app`, and — to confirm the suite is an actual regression guard rather than accidentally green — deliberately re-run as the superuser `folkshops`, where it correctly fails.
- Manual attack sequence via curl: register two stores, confirm cross-tenant login is rejected (`401`), confirm a valid tenant-A token against tenant-B's host is rejected (`403`), confirm no-token requests are rejected (`401`).

## What's deferred

- `RolesGuard`/`@Roles()` for route-level RBAC: the `role` field exists on `memberships` and flows into the JWT, but no route yet needs to restrict by role (no owner-only action exists — that arrives with the first real merchant-admin feature). Building the guard now with no caller would be premature.
- `tenant_domains` / custom domains, seed data scripts, staff invitations.
