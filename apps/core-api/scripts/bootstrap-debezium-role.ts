/**
 * Creates (or updates) Debezium's least-privilege replication role on any
 * Postgres target — RDS included. database/init/01-app-role.sql only
 * creates the role itself (fixed dev password) on a fresh local Docker
 * volume; this covers everywhere else, and is safe to re-run. The
 * SELECT/publication grants themselves live in migration
 * 0026_debezium-replication-role.sql (they need products/categories to
 * already exist, which a migration — not this script — guarantees).
 *
 * Usage:
 *   MIGRATIONS_DATABASE_URL=<admin/owner connection> \
 *   DEBEZIUM_DB_PASSWORD=<a real secret, never hardcoded> \
 *   [DATABASE_SSL=true] \
 *   pnpm --filter @folkshops/core-api db:bootstrap-debezium-role
 */
import { Client } from "pg";
import { pgSslConfig } from "../src/database/ssl";

async function main() {
  const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
  const debeziumPassword = process.env.DEBEZIUM_DB_PASSWORD;

  if (!adminUrl) {
    throw new Error("MIGRATIONS_DATABASE_URL is required (the schema-owning/admin connection).");
  }
  if (!debeziumPassword) {
    throw new Error("DEBEZIUM_DB_PASSWORD is required — never hard-code the replication role's password.");
  }

  const client = new Client({ connectionString: adminUrl, ssl: pgSslConfig() });
  await client.connect();

  try {
    // CREATE/ALTER ROLE ... PASSWORD does not accept bind parameters (DDL
    // string literal, not an expression position) — escape by doubling
    // single quotes, same as bootstrap-app-role.ts.
    const escapedPassword = debeziumPassword.replace(/'/g, "''");

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'folkshops_debezium') THEN
          CREATE ROLE folkshops_debezium WITH LOGIN REPLICATION NOSUPERUSER NOBYPASSRLS PASSWORD '${escapedPassword}';
        ELSE
          ALTER ROLE folkshops_debezium WITH LOGIN REPLICATION NOSUPERUSER NOBYPASSRLS PASSWORD '${escapedPassword}';
        END IF;
      END
      $$;
    `);

    // Don't assume — verify, same discipline as bootstrap-app-role.ts.
    // rolreplication is the one extra check this role needs beyond that
    // script's template (Debezium can't create a replication slot without
    // it), on top of the same non-superuser/non-bypass-RLS guarantees.
    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolreplication: boolean }>(
      "SELECT rolsuper, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = 'folkshops_debezium'",
    );
    const { rolsuper, rolbypassrls, rolreplication } = rows[0];
    if (rolsuper || rolbypassrls) {
      throw new Error(
        `folkshops_debezium has rolsuper=${rolsuper} rolbypassrls=${rolbypassrls} on this target — ` +
          "refusing to continue; this role must be a plain, non-bypass role even though it doesn't need RLS to see WAL changes.",
      );
    }
    if (!rolreplication) {
      throw new Error("folkshops_debezium is missing the REPLICATION attribute — Debezium cannot create a replication slot without it.");
    }

    console.log("folkshops_debezium is ready: rolsuper=false, rolbypassrls=false, rolreplication=true.");
    console.log("Run migration 0026_debezium-replication-role.sql (pnpm db:migrate) to grant table SELECT and create the publication.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
