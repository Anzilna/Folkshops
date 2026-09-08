-- Runs automatically on a fresh local Docker Postgres volume only (see
-- docker-compose.yml's docker-entrypoint-initdb.d mount) — this hook does
-- not exist on RDS or any other externally-managed Postgres; those use
-- apps/core-api/scripts/bootstrap-app-role.ts instead, which does the same
-- thing but takes the password from an env var rather than a hardcoded
-- local-only dev value, and is safe to re-run against an existing DB.
--
-- POSTGRES_USER (folkshops) is a superuser — Postgres RLS is bypassed
-- entirely for superusers and any role with BYPASSRLS, no matter what
-- FORCE ROW LEVEL SECURITY says on the table. The app must connect as a
-- separate, non-superuser role or every RLS policy in the system is
-- silently a no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'folkshops_app') THEN
    CREATE ROLE folkshops_app LOGIN PASSWORD 'folkshops_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO folkshops_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO folkshops_app;

-- Tables created later by migrations (run as the folkshops owner role)
-- must grant this role access automatically, or every new table needs a
-- manual GRANT before the app can use it.
ALTER DEFAULT PRIVILEGES FOR ROLE folkshops IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO folkshops_app;
