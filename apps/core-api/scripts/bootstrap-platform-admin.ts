/**
 * Creates (or updates the password for) a platform admin — there's no
 * self-service registration for these by design (see
 * ../src/platform-admin/platform-admin-auth.service.ts: internal Folkshops
 * staff, not a public signup). Safe to re-run; upserts by email.
 *
 * Usage:
 *   PLATFORM_ADMIN_EMAIL=you@folkshops.com \
 *   PLATFORM_ADMIN_PASSWORD=<a real secret> \
 *   PLATFORM_ADMIN_NAME="Your Name" \
 *   pnpm --filter @folkshops/core-api db:bootstrap-platform-admin
 */
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import { pgSslConfig } from "../src/database/ssl";

const PASSWORD_HASH_ROUNDS = 10;

async function main() {
  const databaseUrl = process.env.DATABASE_PRIMARY_URL;
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const name = process.env.PLATFORM_ADMIN_NAME;

  if (!databaseUrl) throw new Error("DATABASE_PRIMARY_URL is required.");
  if (!email) throw new Error("PLATFORM_ADMIN_EMAIL is required.");
  if (!password) throw new Error("PLATFORM_ADMIN_PASSWORD is required — never hard-code it.");
  if (!name) throw new Error("PLATFORM_ADMIN_NAME is required.");

  const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

  const client = new Client({ connectionString: databaseUrl, ssl: pgSslConfig() });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, updated_at = now()`,
      [email, passwordHash, name],
    );
    console.log(`platform_admins row ready for ${email}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
