import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/database/schema.ts",
  out: "../../database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Schema-owning role, deliberately not the app's runtime role: DDL
    // (CREATE TABLE, CREATE POLICY, ...) is a migration-time privilege the
    // running app should never hold — see MIGRATIONS_DATABASE_URL vs
    // DATABASE_URL in .env.example.
    url:
      process.env.MIGRATIONS_DATABASE_URL ??
      "postgres://folkshops:folkshops@localhost:5432/folkshops_dev",
  },
});
