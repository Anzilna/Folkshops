-- Hand-written (no snapshot bump needed — CREATE ROLE/GRANT/CREATE
-- PUBLICATION don't change any table's column structure, same as the
-- RLS-enable migrations before this one, e.g. 0024).
--
-- folkshops_debezium is a dedicated, least-privilege role for Debezium's
-- PostgreSQL connector (docs/decisions/0009) — REPLICATION login, SELECT
-- on exactly the two CDC-target tables, no BYPASSRLS. Debezium reads via
-- WAL logical decoding, not a filtered SELECT, so RLS is structurally
-- irrelevant to what it can see regardless of this grant — it will observe
-- every tenant's row changes on these two tables. That's a deliberate,
-- documented consequence (see the ADR), not something BYPASSRLS would
-- change either way, which is exactly why this role never gets it.
--
-- Password is set by apps/core-api/scripts/bootstrap-debezium-role.ts (or,
-- for a fresh local Docker volume, database/init/01-app-role.sql's own
-- dev-only fixed-password equivalent) — never hardcoded here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'folkshops_debezium') THEN
    CREATE ROLE folkshops_debezium WITH LOGIN REPLICATION NOSUPERUSER NOBYPASSRLS PASSWORD 'placeholder-set-by-bootstrap-script';
  END IF;
END
$$;

GRANT SELECT ON products, categories TO folkshops_debezium;

-- Created here, by the migration/owner role — not by the connector at
-- runtime (publication.autocreate.mode=disabled in
-- database/debezium/postgres-connector.json). Keeps folkshops_debezium at
-- SELECT + REPLICATION only, never needing CREATE on the database.
CREATE PUBLICATION folkshops_cdc_publication FOR TABLE products, categories;
