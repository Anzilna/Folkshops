-- Runs once, only against a fresh Postgres data volume (see docker-compose.yml
-- docker-entrypoint-initdb.d mount). POSTGRES_USER (folkshops) is a
-- superuser — Postgres RLS is bypassed entirely for superusers and any role
-- with BYPASSRLS, no matter what FORCE ROW LEVEL SECURITY says on the
-- table. The app must connect as a separate, non-superuser role or every
-- RLS policy in the system is silently a no-op.
CREATE ROLE folkshops_app LOGIN PASSWORD 'folkshops_app' NOSUPERUSER NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO folkshops_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO folkshops_app;

-- Tables created later by migrations (run as the folkshops owner role)
-- must grant this role access automatically, or every new table needs a
-- manual GRANT before the app can use it.
ALTER DEFAULT PRIVILEGES FOR ROLE folkshops IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO folkshops_app;
