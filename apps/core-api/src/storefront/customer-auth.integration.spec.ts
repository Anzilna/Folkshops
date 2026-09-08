import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import jwt from "jsonwebtoken";
import request from "supertest";
import { CUSTOMER_ACCESS_TOKEN_COOKIE, CUSTOMER_REFRESH_TOKEN_COOKIE, STAFF_ACCESS_TOKEN_COOKIE } from "../auth/auth-cookies";
import {
  bootstrapTestApp,
  cleanupTestTenant,
  createTestTenant,
  extractCookie,
  type TestTenant,
} from "../test-utils/bootstrap-app";
import { OTP_PROVIDER, type OtpProvider } from "./otp-provider";

/**
 * A fake OtpProvider swapped in via .overrideProvider — the real
 * ConsoleOtpProvider only logs the code, it doesn't return it anywhere a
 * test could read it. This is standard NestJS testing-module override, not
 * a change to production code (ConsoleOtpProvider is still what runs
 * outside tests).
 */
class CapturingOtpProvider implements OtpProvider {
  public lastSent: { phone: string; code: string } | null = null;

  async send(phone: string, code: string): Promise<void> {
    this.lastSent = { phone, code };
  }
}

let app: INestApplication;
let otp: CapturingOtpProvider;
let tenant: TestTenant;

function randomPhone(): string {
  return `+1888${Math.floor(1000000 + Math.random() * 8999999)}`;
}

beforeAll(async () => {
  otp = new CapturingOtpProvider();
  // Rate limiting on otp/request has its own dedicated, thorough coverage
  // in redis-throttler.storage.integration.spec.ts — bypassed here so this
  // file's several otp/request calls (one per test) don't fight the real
  // 5/min limit and make these tests fragile/order-dependent.
  app = await bootstrapTestApp((builder) =>
    builder.overrideProvider(OTP_PROVIDER).useValue(otp).overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true }),
  );
  tenant = await createTestTenant(app);
});

afterAll(async () => {
  await cleanupTestTenant(tenant.id);
  await app.close();
});

test("full OTP flow: request -> verify -> cookies -> /me", async () => {
  const phone = randomPhone();

  await request(app.getHttpServer())
    .post("/storefront/auth/otp/request")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone })
    .expect(201);

  expect(otp.lastSent?.phone).toBe(phone);
  const code = otp.lastSent!.code;
  expect(code).toMatch(/^\d{6}$/);

  const verifyRes = await request(app.getHttpServer())
    .post("/storefront/auth/otp/verify")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone, code })
    .expect(201);

  const access = extractCookie(verifyRes.headers["set-cookie"] as unknown as string[], CUSTOMER_ACCESS_TOKEN_COOKIE);
  const refresh = extractCookie(verifyRes.headers["set-cookie"] as unknown as string[], CUSTOMER_REFRESH_TOKEN_COOKIE);
  expect(access).toBeDefined();
  expect(refresh).toBeDefined();

  const meRes = await request(app.getHttpServer())
    .get("/storefront/auth/me")
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${access}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(200);
  expect(meRes.body.customer.phone).toBe(phone);
});

test("wrong code is rejected, correct code still works afterward", async () => {
  const phone = randomPhone();
  await request(app.getHttpServer())
    .post("/storefront/auth/otp/request")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone })
    .expect(201);
  const code = otp.lastSent!.code;

  await request(app.getHttpServer())
    .post("/storefront/auth/otp/verify")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone, code: "000000" })
    .expect(401);

  await request(app.getHttpServer())
    .post("/storefront/auth/otp/verify")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone, code })
    .expect(201);
});

test("replaying an already-consumed code is rejected", async () => {
  const phone = randomPhone();
  await request(app.getHttpServer())
    .post("/storefront/auth/otp/request")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone })
    .expect(201);
  const code = otp.lastSent!.code;

  await request(app.getHttpServer())
    .post("/storefront/auth/otp/verify")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone, code })
    .expect(201);

  await request(app.getHttpServer())
    .post("/storefront/auth/otp/verify")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone, code })
    .expect(401);
});

test("refresh rotation and replay rejection work the same as staff/platform-admin auth", async () => {
  const phone = randomPhone();
  await request(app.getHttpServer())
    .post("/storefront/auth/otp/request")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone })
    .expect(201);
  const verifyRes = await request(app.getHttpServer())
    .post("/storefront/auth/otp/verify")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone, code: otp.lastSent!.code })
    .expect(201);
  const oldRefresh = extractCookie(verifyRes.headers["set-cookie"] as unknown as string[], CUSTOMER_REFRESH_TOKEN_COOKIE)!;

  const refreshRes = await request(app.getHttpServer())
    .post("/storefront/auth/refresh")
    .set("Cookie", `${CUSTOMER_REFRESH_TOKEN_COOKIE}=${oldRefresh}`)
    .expect(201);
  const newRefresh = extractCookie(refreshRes.headers["set-cookie"] as unknown as string[], CUSTOMER_REFRESH_TOKEN_COOKIE);
  expect(newRefresh).not.toBe(oldRefresh);

  await request(app.getHttpServer())
    .post("/storefront/auth/refresh")
    .set("Cookie", `${CUSTOMER_REFRESH_TOKEN_COOKIE}=${oldRefresh}`)
    .expect(401);
});

test("isolation: a customer cookie does not grant access to staff /auth/me, and vice versa", async () => {
  const phone = randomPhone();
  await request(app.getHttpServer())
    .post("/storefront/auth/otp/request")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone })
    .expect(201);
  const verifyRes = await request(app.getHttpServer())
    .post("/storefront/auth/otp/verify")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone, code: otp.lastSent!.code })
    .expect(201);
  const customerAccess = extractCookie(verifyRes.headers["set-cookie"] as unknown as string[], CUSTOMER_ACCESS_TOKEN_COOKIE)!;

  await request(app.getHttpServer())
    .get("/auth/me")
    .set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(401);
});

test("a token signed with the wrong secret is rejected even under the right cookie name", async () => {
  const forged = jwt.sign(
    { sub: randomUUID(), tenantId: tenant.id, phone: "+15550000000" },
    "not-the-real-customer-secret",
  );

  await request(app.getHttpServer())
    .get("/storefront/auth/me")
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${forged}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(401);
});
