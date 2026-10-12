import { createHash, randomBytes } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { Client } from "pg";
import request from "supertest";
import { DbRouter } from "../database/db-router";
import { outboxEvents } from "../database/schema";
import {
  bootstrapTestApp,
  cleanupTestTenant,
  createTestTenant,
  extractCookie,
  type TestTenant,
} from "../test-utils/bootstrap-app";
import { STAFF_ACCESS_TOKEN_COOKIE, STAFF_REFRESH_TOKEN_COOKIE } from "./auth-cookies";

/**
 * Through the real HTTP layer (supertest against the real app), not by
 * calling AuthService directly — cookie-setting, JwtAuthGuard, and
 * TenantMatchGuard only really get exercised end-to-end this way, the same
 * way this was originally hand-verified with curl earlier in the project.
 */
let app: INestApplication;
let tenant: TestTenant & { ownerEmail: string; ownerPassword: string };

beforeAll(async () => {
  app = await bootstrapTestApp();
  tenant = await createTestTenant(app);
});

afterAll(async () => {
  await cleanupTestTenant(tenant.id);
  await app.close();
});

test("register sets access+refresh cookies and never returns a token in the JSON body", async () => {
  const res = await request(app.getHttpServer())
    .post("/auth/register")
    .send({
      storeName: "Another Store",
      storeSlug: `it-${Date.now()}`,
      email: `owner-${Date.now()}@test.local`,
      password: "password123",
      name: "Owner",
      planSlug: "free", // register() now requires one explicitly — see AuthService's own comment
    })
    .expect(201);

  const setCookie = res.headers["set-cookie"] as unknown as string[];
  expect(extractCookie(setCookie, STAFF_ACCESS_TOKEN_COOKIE)).toBeDefined();
  expect(extractCookie(setCookie, STAFF_REFRESH_TOKEN_COOKIE)).toBeDefined();
  expect(JSON.stringify(res.body)).not.toMatch(/eyJ/); // no JWT-shaped string anywhere in the body

  // The welcome email's trigger — written in register()'s own transaction,
  // picked up by apps/workers (handlers/merchant-registered.ts).
  const outboxRows = await app
    .get(DbRouter)
    .read("strong", (db) => db.select().from(outboxEvents).where(eq(outboxEvents.tenantId, res.body.tenant.id)));
  expect(outboxRows).toHaveLength(1);
  expect(outboxRows[0]).toMatchObject({
    eventType: "merchant.registered",
    aggregateType: "tenant",
    aggregateId: res.body.tenant.id,
    payload: { userId: res.body.user.id },
  });

  await cleanupTestTenant(res.body.tenant.id);
});

test("login issues cookies, and /auth/me works with the access cookie", async () => {
  const loginRes = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);

  const cookies = loginRes.headers["set-cookie"] as unknown as string[];
  const access = extractCookie(cookies, STAFF_ACCESS_TOKEN_COOKIE);
  expect(access).toBeDefined();

  const meRes = await request(app.getHttpServer())
    .get("/auth/me")
    .set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${access}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(200);

  expect(meRes.body.user.email).toBe(tenant.ownerEmail);
  expect(meRes.body.tenant.id).toBe(tenant.id);
});

test("access/refresh rotation: /auth/refresh issues a new pair and rotates the refresh token", async () => {
  const loginRes = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);

  const loginCookies = loginRes.headers["set-cookie"] as unknown as string[];
  const oldRefresh = extractCookie(loginCookies, STAFF_REFRESH_TOKEN_COOKIE)!;

  const refreshRes = await request(app.getHttpServer())
    .post("/auth/refresh")
    .set("Cookie", `${STAFF_REFRESH_TOKEN_COOKIE}=${oldRefresh}`)
    .expect(201);

  const refreshCookies = refreshRes.headers["set-cookie"] as unknown as string[];
  const newRefresh = extractCookie(refreshCookies, STAFF_REFRESH_TOKEN_COOKIE);
  const newAccess = extractCookie(refreshCookies, STAFF_ACCESS_TOKEN_COOKIE);

  expect(newRefresh).toBeDefined();
  expect(newRefresh).not.toBe(oldRefresh);
  // Not asserting newAccess !== oldAccess: JWTs are deterministic given
  // identical claims, and `iat` only has second granularity — a login and
  // an immediate refresh for the same session can legitimately produce a
  // byte-identical access token. The refresh token (a fresh random value
  // every time, not a deterministic function of claims) is the meaningful
  // rotation check.

  // The new access token must actually work.
  await request(app.getHttpServer())
    .get("/auth/me")
    .set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${newAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(200);
});

test("refresh-token replay is rejected: reusing an already-rotated refresh token fails", async () => {
  const loginRes = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);

  const oldRefresh = extractCookie(loginRes.headers["set-cookie"] as unknown as string[], STAFF_REFRESH_TOKEN_COOKIE)!;

  // First use rotates it — this should succeed.
  await request(app.getHttpServer())
    .post("/auth/refresh")
    .set("Cookie", `${STAFF_REFRESH_TOKEN_COOKIE}=${oldRefresh}`)
    .expect(201);

  // Replaying the same (now-revoked) token must be rejected, not silently
  // accepted — this is the actual point of rotation-on-use.
  await request(app.getHttpServer())
    .post("/auth/refresh")
    .set("Cookie", `${STAFF_REFRESH_TOKEN_COOKIE}=${oldRefresh}`)
    .expect(401);
});

test("logout revokes the refresh token: a subsequent refresh attempt fails", async () => {
  const loginRes = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);

  const refresh = extractCookie(loginRes.headers["set-cookie"] as unknown as string[], STAFF_REFRESH_TOKEN_COOKIE)!;

  await request(app.getHttpServer()).post("/auth/logout").set("Cookie", `${STAFF_REFRESH_TOKEN_COOKIE}=${refresh}`).expect(201);

  await request(app.getHttpServer())
    .post("/auth/refresh")
    .set("Cookie", `${STAFF_REFRESH_TOKEN_COOKIE}=${refresh}`)
    .expect(401);
});

test("a token signed with the wrong secret is rejected", async () => {
  const forged = jwt.sign(
    { sub: "00000000-0000-0000-0000-000000000000", tenantId: tenant.id, role: "owner", email: tenant.ownerEmail },
    "not-the-real-secret",
  );

  await request(app.getHttpServer())
    .get("/auth/me")
    .set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${forged}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(401);
});

test("a well-formed token whose tenant claim doesn't match the resolved store is rejected (TenantMatchGuard)", async () => {
  const other = await createTestTenant(app);
  const loginRes = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", other.slug)
    .send({ email: other.ownerEmail, password: other.ownerPassword })
    .expect(201);
  const access = extractCookie(loginRes.headers["set-cookie"] as unknown as string[], STAFF_ACCESS_TOKEN_COOKIE)!;

  // Valid token for `other`, presented against `tenant`'s host.
  await request(app.getHttpServer())
    .get("/auth/me")
    .set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${access}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(403);

  await cleanupTestTenant(other.id);
});

describe("password reset", () => {
  // The worker (apps/workers) mints real tokens; these tests stand in for
  // it by inserting a hashed token directly, same as it would.
  async function mintResetToken(email: string, opts: { expired?: boolean } = {}): Promise<string> {
    const raw = randomBytes(32).toString("hex");
    const client = new Client({ connectionString: process.env.DATABASE_PRIMARY_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         SELECT id, $2, now() + $3::interval FROM users WHERE email = $1`,
        [email, createHash("sha256").update(raw).digest("hex"), opts.expired ? "-1 minute" : "30 minutes"],
      );
    } finally {
      await client.end();
    }
    return raw;
  }

  test("forgot-password answers identically for known and unknown emails, and records a request only for the known one", async () => {
    const known = await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: tenant.ownerEmail }).expect(201);
    const unknown = await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: `nobody-${Date.now()}@test.local` }).expect(201);
    expect(known.body).toEqual(unknown.body);

    const rows = await app
      .get(DbRouter)
      .read("strong", (db) => db.select().from(outboxEvents).where(eq(outboxEvents.eventType, "staff.password_reset_requested")))
      .then((all) => all.filter((r) => r.tenantId === tenant.id));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].payload)).not.toMatch(/[0-9a-f]{64}/); // no token material in the outbox, only userId
  });

  test("a reset token works once, changes the password, and revokes existing sessions", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .set("X-Tenant-Id", tenant.slug)
      .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
      .expect(201);
    const oldRefresh = extractCookie(login.headers["set-cookie"] as unknown as string[], STAFF_REFRESH_TOKEN_COOKIE)!;

    const token = await mintResetToken(tenant.ownerEmail);
    const newPassword = "brand-new-password";
    await request(app.getHttpServer()).post("/auth/reset-password").send({ token, password: newPassword }).expect(201);
    await request(app.getHttpServer()).post("/auth/reset-password").send({ token, password: "second-attempt-1" }).expect(400);

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", `${STAFF_REFRESH_TOKEN_COOKIE}=${oldRefresh}`)
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/login")
      .set("X-Tenant-Id", tenant.slug)
      .send({ email: tenant.ownerEmail, password: newPassword })
      .expect(201);
    tenant.ownerPassword = newPassword;
  });

  test("an expired reset token is rejected", async () => {
    const token = await mintResetToken(tenant.ownerEmail, { expired: true });
    await request(app.getHttpServer()).post("/auth/reset-password").send({ token, password: "whatever-123" }).expect(400);
  });
});
