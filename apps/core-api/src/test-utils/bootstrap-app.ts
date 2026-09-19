import { randomUUID } from "node:crypto";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModuleBuilder } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../app.module";

/**
 * Boots the real app (real Postgres + Redis, real guards/middleware) the
 * same way main.ts does, minus CORS (irrelevant — supertest is a Node HTTP
 * client, not a browser). Used by *.integration.spec.ts files that test
 * through the HTTP layer rather than calling services directly, so cookie
 * parsing / DTO validation / guards are exercised exactly as they are in
 * production, not approximated.
 */
export async function bootstrapTestApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (configure) builder = configure(builder);
  const moduleRef = await builder.compile();
  // rawBody: true — same as main.ts's NestFactory.create() option, needed
  // so req.rawBody is populated for any test exercising
  // StripeSignatureGuard/the webhook route, not just production boot.
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser());
  await app.init();
  return app;
}

export interface TestTenant {
  id: string;
  slug: string;
}

/** Registers a fresh store via the real /auth/register endpoint — same path a real merchant signup takes, not a DB shortcut. */
export async function createTestTenant(
  app: INestApplication,
): Promise<TestTenant & { ownerEmail: string; ownerPassword: string }> {
  const suffix = randomUUID().slice(0, 8);
  const slug = `it-${suffix}`;
  const ownerEmail = `owner-${suffix}@test.local`;
  const ownerPassword = "password123";

  const res = await request(app.getHttpServer())
    .post("/auth/register")
    .send({
      storeName: `Integration Test ${suffix}`,
      storeSlug: slug,
      email: ownerEmail,
      password: ownerPassword,
      name: "Owner",
    })
    .expect(201);

  return { id: res.body.tenant.id, slug, ownerEmail, ownerPassword };
}

function rawPgUrl(): string {
  return process.env.DATABASE_PRIMARY_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";
}

/**
 * Cleans up everything a test tenant could have created — mirrors the
 * teardown pattern in database/rls-tests. The RLS-protected deletes MUST
 * run in the same transaction as the set_config call: set_config(...,
 * true) is transaction-local (like SET LOCAL), so on separate
 * auto-committed statements the tenant context is already gone by the
 * next query, meaning those deletes would silently affect zero rows and
 * the final DELETE FROM tenants would then hit a foreign-key violation.
 * Every table here needs deleting in FK-dependency order (child before
 * parent) — see the inline comments below for exactly which depends on
 * which; getting this wrong surfaces as a foreign-key-violation error
 * from whichever table was deleted too early, not a silent no-op.
 */
export async function cleanupTestTenant(tenantId: string): Promise<void> {
  const client = new Client({ connectionString: rawPgUrl() });
  await client.connect();
  try {
    // payment_order_lookup FKs both orders and payments — it must be
    // cleared before either, or deleting an order/payment it still points
    // at fails with a FK violation. Not RLS-protected (see its own schema
    // comment), so no tenant context/transaction needed for this one.
    await client.query(`DELETE FROM payment_order_lookup WHERE tenant_id = $1`, [tenantId]);
    // outbox_events is the same "not RLS-protected, no tenant context
    // needed" shape — see its own schema comment. Same class of gap as
    // bug #17.
    await client.query(`DELETE FROM outbox_events WHERE tenant_id = $1`, [tenantId]);

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(`DELETE FROM otp_codes WHERE tenant_id = $1`, [tenantId]);
    // cart_items -> carts -> customers, in that order (each FKs the one
    // before it) — missing before now, only surfaced once a test actually
    // exercised the cart/checkout flow (storefront-payments.integration.spec.ts,
    // the first one to). Same class of gap as bug #17.
    await client.query(`DELETE FROM cart_items WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM carts WHERE tenant_id = $1`, [tenantId]);
    // payment_events -> payments -> order_items/orders, in that order.
    // payment_accounts has no FK to orders/customers, just tenants, so its
    // position relative to these doesn't matter — grouped here anyway
    // since it's the same payments feature. Same class of gap as bug #17.
    await client.query(`DELETE FROM payment_events WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM payments WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM payment_accounts WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM order_items WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM orders WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM customers WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM products WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM memberships WHERE tenant_id = $1`, [tenantId]);
    await client.query("COMMIT");

    // Not RLS-protected (see refresh-tokens.ts / membership-lookup.ts),
    // so no tenant context needed — fine as separate statements.
    await client.query(`DELETE FROM refresh_tokens WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM membership_lookup WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

/** Directly inserts a platform admin row — there's no register endpoint by design (see PlatformAdminAuthService), so tests provision one the same way scripts/bootstrap-platform-admin.ts does. */
export async function createTestPlatformAdmin(): Promise<{ id: string; email: string; password: string }> {
  const suffix = randomUUID().slice(0, 8);
  const email = `pa-${suffix}@test.local`;
  const password = "password123";
  const passwordHash = await bcrypt.hash(password, 10);

  const client = new Client({ connectionString: rawPgUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO platform_admins (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id`,
      [email, passwordHash, "Test Admin"],
    );
    return { id: rows[0].id, email, password };
  } finally {
    await client.end();
  }
}

export async function cleanupTestPlatformAdmin(id: string): Promise<void> {
  const client = new Client({ connectionString: rawPgUrl() });
  await client.connect();
  try {
    await client.query(`DELETE FROM refresh_tokens WHERE subject_id = $1`, [id]);
    await client.query(`DELETE FROM platform_admins WHERE id = $1`, [id]);
  } finally {
    await client.end();
  }
}

/** Parses the "name=value" pair out of a raw Set-Cookie header string, ignoring attributes (Path, HttpOnly, Max-Age, ...). */
export function extractCookie(setCookieHeaders: string[] | undefined, name: string): string | undefined {
  const header = setCookieHeaders?.find((c) => c.startsWith(`${name}=`));
  return header?.split(";")[0]?.split("=")[1];
}
