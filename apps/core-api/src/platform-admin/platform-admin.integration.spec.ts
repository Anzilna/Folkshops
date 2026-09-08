import { INestApplication } from "@nestjs/common";
import jwt from "jsonwebtoken";
import request from "supertest";
import {
  PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE,
  PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE,
  STAFF_ACCESS_TOKEN_COOKIE,
} from "../auth/auth-cookies";
import {
  bootstrapTestApp,
  cleanupTestPlatformAdmin,
  cleanupTestTenant,
  createTestPlatformAdmin,
  createTestTenant,
  extractCookie,
  type TestTenant,
} from "../test-utils/bootstrap-app";

let app: INestApplication;
let admin: { id: string; email: string; password: string };
let tenant: TestTenant & { ownerEmail: string; ownerPassword: string };

beforeAll(async () => {
  app = await bootstrapTestApp();
  admin = await createTestPlatformAdmin();
  tenant = await createTestTenant(app);
});

afterAll(async () => {
  await cleanupTestPlatformAdmin(admin.id);
  await cleanupTestTenant(tenant.id);
  await app.close();
});

test("login issues cookies, and /platform-admin/auth/me works with the access cookie", async () => {
  const loginRes = await request(app.getHttpServer())
    .post("/platform-admin/auth/login")
    .send({ email: admin.email, password: admin.password })
    .expect(201);

  const access = extractCookie(loginRes.headers["set-cookie"] as unknown as string[], PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE);
  expect(access).toBeDefined();

  const meRes = await request(app.getHttpServer())
    .get("/platform-admin/auth/me")
    .set("Cookie", `${PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE}=${access}`)
    .expect(200);

  expect(meRes.body.admin.email).toBe(admin.email);
});

test("access/refresh rotation works the same as staff auth", async () => {
  const loginRes = await request(app.getHttpServer())
    .post("/platform-admin/auth/login")
    .send({ email: admin.email, password: admin.password })
    .expect(201);
  const oldRefresh = extractCookie(loginRes.headers["set-cookie"] as unknown as string[], PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE)!;

  const refreshRes = await request(app.getHttpServer())
    .post("/platform-admin/auth/refresh")
    .set("Cookie", `${PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE}=${oldRefresh}`)
    .expect(201);
  const newRefresh = extractCookie(refreshRes.headers["set-cookie"] as unknown as string[], PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE);
  expect(newRefresh).not.toBe(oldRefresh);

  // Replaying the rotated-out token must fail.
  await request(app.getHttpServer())
    .post("/platform-admin/auth/refresh")
    .set("Cookie", `${PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE}=${oldRefresh}`)
    .expect(401);
});

test("isolation: a valid staff cookie does not grant access to /platform-admin/auth/me", async () => {
  const staffLogin = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);
  const staffAccess = extractCookie(staffLogin.headers["set-cookie"] as unknown as string[], STAFF_ACCESS_TOKEN_COOKIE)!;

  // No fk_pa_access_token cookie present at all.
  await request(app.getHttpServer()).get("/platform-admin/auth/me").expect(401);

  // Even presenting the staff token *as* the platform-admin cookie name
  // must fail — different signing secret entirely, not just a different
  // cookie name.
  await request(app.getHttpServer())
    .get("/platform-admin/auth/me")
    .set("Cookie", `${PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE}=${staffAccess}`)
    .expect(401);
});

test("isolation: a valid platform-admin cookie does not grant access to staff /auth/me", async () => {
  const paLogin = await request(app.getHttpServer())
    .post("/platform-admin/auth/login")
    .send({ email: admin.email, password: admin.password })
    .expect(201);
  const paAccess = extractCookie(paLogin.headers["set-cookie"] as unknown as string[], PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE)!;

  await request(app.getHttpServer())
    .get("/auth/me")
    .set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${paAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(401);
});

test("a token signed with the wrong secret is rejected even under the right cookie name", async () => {
  const forged = jwt.sign({ sub: admin.id, email: admin.email }, "not-the-real-platform-admin-secret");

  await request(app.getHttpServer())
    .get("/platform-admin/auth/me")
    .set("Cookie", `${PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE}=${forged}`)
    .expect(401);
});
