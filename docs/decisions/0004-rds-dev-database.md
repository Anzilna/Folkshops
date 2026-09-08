# 0004 — AWS RDS as the (eventual) dev database

## Context

Production always used RDS Postgres. This records the plumbing added so interactive dev can point at RDS too — "developing against the real AWS architecture" — while CI/offline dev keeps using local Docker Postgres, since CI runners typically can't reach an RDS instance sitting in a private VPC.

As of this writing, **no RDS instance has been confirmed to exist yet** (checked: AWS CLI is installed locally but has no credentials configured, so it couldn't be verified either way). Nothing here provisions one — that's an explicit non-goal per instruction ("do not provision a new RDS instance automatically"). This ADR is the code-readiness work done ahead of having a real endpoint, plus the runbook for the moment one exists.

## What changed

- **`apps/core-api/src/database/ssl.ts`**: a single `pgSslConfig()` used identically by the app's `Pool`, `drizzle.config.ts`, and the bootstrap script below — off by default (`DATABASE_SSL=true` turns it on), so nothing changes for local Docker dev. One shared function so the three call sites can't drift on what "SSL on" means.
- **`drizzle.config.ts`**: switched from `{ url }` to discrete `{ host, port, user, password, database, ssl }` credentials — drizzle-kit's postgres `dbCredentials` type is a strict union of the two forms, `url` and `ssl` can't be passed together, so SSL support requires parsing the connection string ourselves.
- **`database/init/01-app-role.sql`**: made idempotent (`IF NOT EXISTS` guard) — it only ever ran once automatically anyway (Docker's `docker-entrypoint-initdb.d` only fires on a fresh volume), but idempotency means it's also safe if manually re-run.
- **`apps/core-api/scripts/bootstrap-app-role.ts`** (new): does the same `CREATE ROLE folkshops_app` + grants as the init script, but for any target reachable via `MIGRATIONS_DATABASE_URL` — RDS has no init-hook equivalent, so this has to be run manually once. Takes the password from `APP_DB_PASSWORD` (never hardcoded — the init `.sql` file's hardcoded local password is fine only because it's a fixed, throwaway, localhost-only dev value). It's idempotent (safe to re-run — `ALTER ROLE` if the role already exists) and, critically, **verifies the resulting role's `rolsuper`/`rolbypassrls` flags and refuses to continue if either is true** — this exact assumption (a role silently bypassing RLS) was wrong once already on local Docker (see `0003-tenancy-rls.md`), and AWS's RDS master user carries `rds_superuser`, not plain Postgres superuser, so whether it bypasses RLS isn't something to assume in either direction without checking.

## Full setup flow, once an RDS endpoint exists

1. Confirm the instance and get: endpoint, port, database name, master username/password, and whether it's reachable from wherever `pnpm dev` runs (public access + security group, or a VPN/bastion/tunnel).
2. Put the **master/admin** connection in `apps/core-api/.env` as `MIGRATIONS_DATABASE_URL`, with `DATABASE_SSL=true`.
3. Run the bootstrap script once:
   ```bash
   MIGRATIONS_DATABASE_URL=<master-conn> APP_DB_PASSWORD=<generate a real secret> DATABASE_SSL=true \
     pnpm --filter @folkshops/core-api db:bootstrap-app-role
   ```
   This creates `folkshops_app` on RDS and fails loudly if it turns out to bypass RLS.
4. Set `DATABASE_PRIMARY_URL` in `.env` to the `folkshops_app` connection (same host, that role's credentials), keep `DATABASE_SSL=true`. Set `DATABASE_REPLICA_URL` to the same value until a real RDS Read Replica exists — see `0005-primary-replica-routing.md`.
5. Apply migrations: `pnpm --filter @folkshops/core-api db:migrate` (uses `MIGRATIONS_DATABASE_URL`, i.e. the master role).
6. Boot the app: `pnpm --filter @folkshops/core-api dev` — `/health` should report `db: "connected"`.
7. **Re-run the mandatory RLS suite against RDS specifically** — switching the underlying database is exactly the kind of change rule 8 requires re-verifying, not assuming still holds:
   ```bash
   RLS_TEST_DATABASE_URL=<folkshops_app conn on RDS> pnpm --filter @folkshops/rls-tests test
   ```

## What's still local-only

- `docker-compose.yml`'s Postgres service is unchanged and stays — it's what CI uses (GitHub Actions can't reach a private-VPC RDS instance without significantly more networking setup, which isn't justified yet for a single dev database), and it remains the fallback for fully offline work.
- Redis is unaffected by any of this — no ElastiCache-for-dev decision has been made or asked for.

## Not yet verified

The SSL-on code path (`DATABASE_SSL=true`) has not been exercised against a real TLS-terminating Postgres, since none was available. It compiles and the SSL-off path (default, used by every test in this session) is fully verified. Treat the SSL path as unverified until step 6-7 above are actually run against RDS.
