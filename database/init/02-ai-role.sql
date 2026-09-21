-- Same fresh-volume-only convenience as 01-app-role.sql (see that file's
-- own header comment) — a separate least-privilege role for apps/ai-service,
-- deliberately NOT granted blanket access the way folkshops_app is. If the
-- AI service is ever compromised (it embeds untrusted document content and
-- will eventually execute LLM-issued tool calls), it must not be able to
-- read payments/orders directly — it goes through the same tool-
-- authorization path everything else does. See docs/decisions/0011.
--
-- No ALTER DEFAULT PRIVILEGES here on purpose: this role's grants are scoped
-- table-by-table in apps/ai-service/migrations/0001_init.sql (an explicit
-- GRANT on exactly the 4 tables this service owns), not "every future table
-- in the schema" the way folkshops_app's blanket grant is.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'folkshops_ai') THEN
    CREATE ROLE folkshops_ai LOGIN PASSWORD 'folkshops_ai' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO folkshops_ai;
