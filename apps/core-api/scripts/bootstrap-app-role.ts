/**
 * Creates (or updates) the app's least-privilege runtime role on any
 * Postgres target — RDS included. database/init/01-app-role.sql only runs
 * automatically on a fresh local Docker volume; this covers everywhere
 * else, and is safe to re-run.
 *
 * Usage:
 *   MIGRATIONS_DATABASE_URL=<admin/owner connection> \
 *   APP_DB_PASSWORD=<a real secret, never hardcoded> \
 *   [DATABASE_SSL=true] \
 *   pnpm --filter @folkshops/core-api db:bootstrap-app-role
 */
import { Client } from "pg";
import { pgSslConfig } from "../src/database/ssl";

async function main() {
  const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
  const appPassword = process.env.APP_DB_PASSWORD;

  if (!adminUrl) {
    throw new Error("MIGRATIONS_DATABASE_URL is required (the schema-owning/admin connection).");
  }
  if (!appPassword) {
    throw new Error("APP_DB_PASSWORD is required — never hard-code the app role's password.");
  }

  const client = new Client({ connectionString: adminUrl, ssl: pgSslConfig() });
  await client.connect();

  try {
    const { rows: ownerRows } = await client.query<{ current_user: string }>("SELECT current_user");
    const owner = ownerRows[0].current_user;

    // CREATE ROLE ... PASSWORD does not accept bind parameters (it's a DDL
    // string literal, not an expression position) — escape by doubling
    // single quotes, the standard Postgres string-literal escape. The
    // password is an operator-supplied secret, not untrusted network
    // input, so this is the same trust boundary as any other ops script.
    const escapedPassword = appPassword.replace(/'/g, "''");

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'folkshops_app') THEN
          CREATE ROLE folkshops_app LOGIN PASSWORD '${escapedPassword}' NOSUPERUSER NOBYPASSRLS;
        ELSE
          ALTER ROLE folkshops_app WITH LOGIN PASSWORD '${escapedPassword}' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END
      $$;
    `);

    await client.query("GRANT USAGE ON SCHEMA public TO folkshops_app");
    await client.query("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO folkshops_app");
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO folkshops_app`,
    );

    // Don't assume — verify. This exact assumption (that a role isn't
    // secretly exempt from RLS) was wrong once already on local Docker;
    // AWS's RDS master user carries rds_superuser, not plain superuser,
    // and its RLS-bypass behavior isn't something to guess at either.
    const { rows: roleRows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'folkshops_app'",
    );
    const { rolsuper, rolbypassrls } = roleRows[0];
    if (rolsuper || rolbypassrls) {
      throw new Error(
        `folkshops_app has rolsuper=${rolsuper} rolbypassrls=${rolbypassrls} on this target — ` +
          "RLS would be silently bypassed. Refusing to continue; this role must be a plain, non-bypass role.",
      );
    }

    console.log("folkshops_app is ready: rolsuper=false, rolbypassrls=false — RLS will be enforced for this role.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
