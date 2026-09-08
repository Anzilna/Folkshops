import { defineConfig } from "drizzle-kit";
import { pgSslConfig } from "./src/database/ssl";

// drizzle-kit's postgres dbCredentials type is `{ url }` OR the discrete
// fields — never both, so `ssl` can't ride alongside `url`. Parsing it out
// ourselves keeps SSL control explicit rather than depending on whether
// drizzle-kit's own connection-string parsing honors `sslmode=...`.
const migrationsUrl = new URL(
  process.env.MIGRATIONS_DATABASE_URL ?? "postgres://folkshops:folkshops@localhost:5432/folkshops_dev",
);

export default defineConfig({
  schema: "./src/database/schema/index.ts",
  out: "../../database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Schema-owning role, deliberately not the app's runtime role: DDL
    // (CREATE TABLE, CREATE POLICY, ...) is a migration-time privilege the
    // running app should never hold — see MIGRATIONS_DATABASE_URL vs
    // DATABASE_URL in .env.example.
    host: migrationsUrl.hostname,
    port: migrationsUrl.port ? Number(migrationsUrl.port) : 5432,
    user: decodeURIComponent(migrationsUrl.username),
    password: decodeURIComponent(migrationsUrl.password),
    database: migrationsUrl.pathname.replace(/^\//, ""),
    ssl: pgSslConfig(),
  },
});
