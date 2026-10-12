import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Client } from "pg";
import request from "supertest";
import {
  PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE,
  PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE,
  STAFF_ACCESS_TOKEN_COOKIE,
  STAFF_REFRESH_TOKEN_COOKIE,
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
import { INTERNAL_SERVICE_HEADER } from "../mcp/guards/internal-service.guard";

/**
 * The platform admin's management surface end to end: tenant detail,
 * suspend/reactivate AND that suspension is actually enforced everywhere a
 * suspended store's people could still get in, the audit trail, team
 * management, password change, plans and the activity feed.
 */

const SERVICE_TOKEN = "test-internal-service-token";
process.env.INTERNAL_SERVICE_TOKEN = SERVICE_TOKEN;

type Store = TestTenant & { ownerEmail: string; ownerPassword: string };

let app: INestApplication;
let admin: { id: string; email: string; password: string };
let adminCookie: string;
let storeA: Store;
let storeB: Store;
const createdAdminIds: string[] = [];

const http = () => request(app.getHttpServer());
const asAdmin = (cookie = adminCookie) => ({ Cookie: `${PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE}=${cookie}` });

async function loginAdmin(email: string, password: string) {
  const res = await http().post("/platform-admin/auth/login").send({ email, password });
  const cookies = res.headers["set-cookie"] as unknown as string[] | undefined;
  return {
    status: res.status,
    access: extractCookie(cookies, PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE),
    refresh: extractCookie(cookies, PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE),
  };
}

async function staffLogin(store: Store) {
  const res = await http().post("/auth/login").set("X-Tenant-Id", store.slug).send({ email: store.ownerEmail, password: store.ownerPassword });
  const cookies = res.headers["set-cookie"] as unknown as string[] | undefined;
  return {
    res,
    access: extractCookie(cookies, STAFF_ACCESS_TOKEN_COOKIE),
    refresh: extractCookie(cookies, STAFF_REFRESH_TOKEN_COOKIE),
  };
}

beforeAll(async () => {
  // Rate limiting has its own dedicated coverage; these tests log in far
  // more often than the real per-minute limit allows.
  app = await bootstrapTestApp((b) => b.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true }));
  admin = await createTestPlatformAdmin();
  createdAdminIds.push(admin.id);
  adminCookie = (await loginAdmin(admin.email, admin.password)).access!;
  storeA = await createTestTenant(app);
  storeB = await createTestTenant(app);
});

afterAll(async () => {
  for (const id of createdAdminIds) await cleanupTestPlatformAdmin(id);
  await cleanupTestTenant(storeA.id);
  await cleanupTestTenant(storeB.id);
  await app.close();
});

describe("access control", () => {
  test("every management route needs a platform-admin session; a store owner's session is not enough", async () => {
    const owner = await staffLogin(storeA);
    const staffCookie = { Cookie: `${STAFF_ACCESS_TOKEN_COOKIE}=${owner.access}` };

    for (const path of ["/platform-admin/tenants", `/platform-admin/tenants/${storeA.id}`, "/platform-admin/plans", "/platform-admin/activity", "/platform-admin/audit-log", "/platform-admin/admins"]) {
      await http().get(path).expect(401);
      await http().get(path).set(staffCookie).expect(401);
    }
    await http().post(`/platform-admin/tenants/${storeA.id}/suspend`).set(staffCookie).send({ reason: "nope nope" }).expect(401);
  });

  test("a non-UUID id is a 400, not a database error", async () => {
    await http().get("/platform-admin/tenants/not-a-uuid").set(asAdmin()).expect(400);
  });
});

describe("tenants", () => {
  test("the list carries each store's plan and subscription status", async () => {
    const res = await http().get(`/platform-admin/tenants?search=${storeA.slug}`).set(asAdmin()).expect(200);
    const row = res.body.data.find((t: { id: string }) => t.id === storeA.id);
    expect(row).toMatchObject({ slug: storeA.slug, status: "active", suspendedAt: null });
    expect(row.planName).toEqual(expect.any(String));
    expect(row.subscriptionStatus).toEqual(expect.any(String));
    expect(row).not.toHaveProperty("suspensionReason");
  });

  test("detail shows owner, plan, usage, payments and history", async () => {
    const res = await http().get(`/platform-admin/tenants/${storeA.id}`).set(asAdmin()).expect(200);
    expect(res.body.tenant).toMatchObject({ id: storeA.id, slug: storeA.slug, status: "active", suspensionReason: null });
    expect(res.body.owners.map((o: { email: string }) => o.email)).toContain(storeA.ownerEmail);
    expect(res.body.subscription).toMatchObject({ planName: expect.any(String), status: expect.any(String) });
    expect(res.body.usage).toEqual({ products: 0, customers: 0, orders: 0, paidOrders: 0, paidRevenueCents: 0 });
    expect(res.body.history).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/password|stripe/i);
  });

  test("unknown store is a 404", async () => {
    await http().get("/platform-admin/tenants/00000000-0000-4000-8000-000000000000").set(asAdmin()).expect(404);
  });
});

describe("suspend / reactivate", () => {
  test("a reason is required and whitespace doesn't count", async () => {
    await http().post(`/platform-admin/tenants/${storeA.id}/suspend`).set(asAdmin()).send({}).expect(400);
    await http().post(`/platform-admin/tenants/${storeA.id}/suspend`).set(asAdmin()).send({ reason: "     " }).expect(400);
    await http().post(`/platform-admin/tenants/${storeA.id}/suspend`).set(asAdmin()).send({ reason: "ab" }).expect(400);
  });

  test("suspending a store locks out its people everywhere, leaves other stores alone, and is fully audited", async () => {
    const before = await staffLogin(storeA);
    expect(before.res.status).toBe(201);
    const summaryBefore = (await http().get("/platform-admin/dashboard").set(asAdmin()).expect(200)).body;

    await http()
      .post(`/platform-admin/tenants/${storeA.id}/suspend`)
      .set(asAdmin())
      .send({ reason: "  chargeback fraud investigation  " })
      .expect(201)
      .expect({ ok: true, status: "suspended" });

    // A shopper can't start signing in either.
    await http().post("/storefront/auth/otp/request").set("X-Tenant-Id", storeA.slug).send({ phone: "+971501234567" }).expect(403);

    // The storefront, as seen by a shopper on the store's own hostname.
    const storefront = await http().get("/storefront/store").set("X-Tenant-Id", storeA.slug).expect(403);
    expect(storefront.body).toMatchObject({ code: "store_suspended" });
    // The reason is internal: nothing the store's people can see contains it.
    expect(JSON.stringify(storefront.body)).not.toContain("chargeback");

    // Staff: a fresh login is refused with a clear reason...
    const login = await staffLogin(storeA);
    expect(login.res.status).toBe(403);
    expect(login.res.body).toMatchObject({ code: "store_suspended" });
    // ...an access token they already held is refused at the door...
    await http().get("/auth/me").set("X-Tenant-Id", storeA.slug).set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${before.access}`).expect(403);
    // ...and their refresh token was revoked, so the session can't be renewed.
    await http().post("/auth/refresh").set("Cookie", `${STAFF_REFRESH_TOKEN_COOKIE}=${before.refresh}`).expect(401);

    // Logout must keep working, so a suspended user can clear their own cookies.
    await http().post("/auth/logout").set("X-Tenant-Id", storeA.slug).set("Cookie", `${STAFF_REFRESH_TOKEN_COOKIE}=${before.refresh}`).expect(201);

    // The AI tool endpoints refuse it too — they identify the store from the
    // token, not a hostname, so the front-door guard never sees them.
    await http()
      .post("/internal/mcp/staff")
      .set("Accept", "application/json, text/event-stream")
      .set(INTERNAL_SERVICE_HEADER, SERVICE_TOKEN)
      .set("Authorization", `Bearer ${before.access}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      .expect(403);

    // A different store is untouched.
    await http().get("/storefront/store").set("X-Tenant-Id", storeB.slug).expect(200);
    expect((await staffLogin(storeB)).res.status).toBe(201);

    // The dashboard counts it.
    const summaryAfter = (await http().get("/platform-admin/dashboard").set(asAdmin()).expect(200)).body;
    expect(summaryAfter.tenantCounts.suspended).toBe(summaryBefore.tenantCounts.suspended + 1);

    // Detail shows it, with the (trimmed) internal reason.
    const detail = (await http().get(`/platform-admin/tenants/${storeA.id}`).set(asAdmin()).expect(200)).body;
    expect(detail.tenant).toMatchObject({ status: "suspended", suspensionReason: "chargeback fraud investigation" });
    expect(detail.tenant.suspendedAt).toEqual(expect.any(String));
    expect(detail.history[0]).toMatchObject({ action: "tenant.suspended", adminEmail: admin.email, targetLabel: expect.any(String) });
    expect(detail.history[0].metadata).toEqual({ reason: "chargeback fraud investigation" });

    // The list reflects it.
    const list = (await http().get("/platform-admin/tenants?status=suspended").set(asAdmin()).expect(200)).body;
    expect(list.data.map((t: { id: string }) => t.id)).toContain(storeA.id);
  });

  test("suspending twice is a conflict and writes no second log entry", async () => {
    await http().post(`/platform-admin/tenants/${storeA.id}/suspend`).set(asAdmin()).send({ reason: "again please" }).expect(409);
    const log = (await http().get("/platform-admin/audit-log?action=tenant.suspended&limit=100").set(asAdmin()).expect(200)).body;
    expect(log.data.filter((r: { tenantId: string }) => r.tenantId === storeA.id)).toHaveLength(1);
  });

  test("reactivating restores access and keeps the history", async () => {
    await http().post(`/platform-admin/tenants/${storeA.id}/reactivate`).set(asAdmin()).expect(201).expect({ ok: true, status: "active" });

    await http().get("/storefront/store").set("X-Tenant-Id", storeA.slug).expect(200);
    expect((await staffLogin(storeA)).res.status).toBe(201);

    const detail = (await http().get(`/platform-admin/tenants/${storeA.id}`).set(asAdmin()).expect(200)).body;
    expect(detail.tenant).toMatchObject({ status: "active", suspendedAt: null, suspensionReason: null });
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(["tenant.reactivated", "tenant.suspended"]);
    // Clearing the reason from the store must not erase why it happened.
    expect(detail.history[0].metadata).toEqual({ previousReason: "chargeback fraud investigation" });

    await http().post(`/platform-admin/tenants/${storeA.id}/reactivate`).set(asAdmin()).expect(409);
  });
});

describe("audit log and activity feed", () => {
  test("the audit log is filterable and newest first", async () => {
    const all = (await http().get("/platform-admin/audit-log?limit=100").set(asAdmin()).expect(200)).body;
    expect(all.total).toBeGreaterThanOrEqual(2);
    const times = all.data.map((r: { createdAt: string }) => r.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    const reactivated = (await http().get("/platform-admin/audit-log?action=tenant.reactivated&limit=100").set(asAdmin()).expect(200)).body;
    expect(reactivated.data.every((r: { action: string }) => r.action === "tenant.reactivated")).toBe(true);
    await http().get("/platform-admin/audit-log?action=nonsense").set(asAdmin()).expect(400);
  });

  test("the activity feed mixes real platform events with admin actions", async () => {
    const feed = (await http().get("/platform-admin/activity?limit=50").set(asAdmin()).expect(200)).body as { id: string; kind: string; title: string; body: string; href?: string }[];
    expect(feed.find((i) => i.title === "New store" && i.body.includes("just signed up") && i.href === `/tenants/${storeA.id}`)).toBeDefined();
    expect(feed.find((i) => i.title === "Store suspended" && i.kind === "security")).toBeDefined();
    expect(feed.find((i) => i.title === "Store reactivated")).toBeDefined();
  });
});

describe("plans", () => {
  test("lists plans with subscriber counts and never exposes Stripe ids", async () => {
    const res = await http().get("/platform-admin/plans").set(asAdmin()).expect(200);
    const slugs = res.body.data.map((p: { slug: string }) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(["basic", "standard", "advanced"]));
    const prices = res.body.data.map((p: { priceCents: number }) => p.priceCents);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    const free = res.body.data.find((p: { slug: string }) => p.slug === "free");
    expect(free.totalSubscriptions).toBeGreaterThanOrEqual(2); // the two test stores
    expect(JSON.stringify(res.body)).not.toMatch(/stripe/i);
  });
});

describe("team", () => {
  let second: { id: string; email: string; password: string };

  test("an admin can add a teammate; the response never carries a password hash", async () => {
    const email = `Second-${Date.now()}@Test.Local`;
    const res = await http().post("/platform-admin/admins").set(asAdmin()).send({ email: `  ${email}  `, name: "  Second Admin ", password: "a-long-password-1" }).expect(201);
    expect(res.body).toMatchObject({ email: email.toLowerCase(), name: "Second Admin", lastLoginAt: null });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|password/i);
    createdAdminIds.push(res.body.id);
    second = { id: res.body.id, email: res.body.email, password: "a-long-password-1" };
  });

  test("duplicate emails are refused, case-insensitively; weak or oversized passwords too", async () => {
    await http().post("/platform-admin/admins").set(asAdmin()).send({ email: second.email.toUpperCase(), name: "Dup", password: "a-long-password-1" }).expect(409);
    await http().post("/platform-admin/admins").set(asAdmin()).send({ email: "short@test.local", name: "S", password: "short" }).expect(400);
    await http().post("/platform-admin/admins").set(asAdmin()).send({ email: "long@test.local", name: "L", password: "x".repeat(73) }).expect(400);
    await http().post("/platform-admin/admins").set(asAdmin()).send({ email: "not-an-email", name: "N", password: "a-long-password-1" }).expect(400);
  });

  test("the new admin can sign in (any capitalisation of their email), and the list shows their last sign-in", async () => {
    const login = await loginAdmin(second.email.toUpperCase(), second.password);
    expect(login.status).toBe(201);

    const list = (await http().get("/platform-admin/admins?limit=100").set(asAdmin()).expect(200)).body;
    const row = list.data.find((a: { id: string }) => a.id === second.id);
    expect(row.lastLoginAt).toEqual(expect.any(String));
    expect(list.data.find((a: { id: string }) => a.id === admin.id)).toBeDefined();
  });

  test("you can't remove yourself, and unknown ids are 404", async () => {
    await http().delete(`/platform-admin/admins/${admin.id}`).set(asAdmin()).expect(400);
    await http().delete("/platform-admin/admins/00000000-0000-4000-8000-000000000000").set(asAdmin()).expect(404);
  });

  test("a removed admin loses access on their very next request, and can't sign back in or refresh", async () => {
    const session = await loginAdmin(second.email, second.password);
    await http().get("/platform-admin/tenants").set(asAdmin(session.access)).expect(200);

    await http().delete(`/platform-admin/admins/${second.id}`).set(asAdmin()).expect(200);

    // Access token is still cryptographically valid for minutes — the guard
    // must refuse it anyway.
    await http().get("/platform-admin/tenants").set(asAdmin(session.access)).expect(401);
    await http().get("/platform-admin/auth/me").set(asAdmin(session.access)).expect(401);
    await http().post("/platform-admin/auth/refresh").set("Cookie", `${PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE}=${session.refresh}`).expect(401);
    expect((await loginAdmin(second.email, second.password)).status).toBe(401);

    const log = (await http().get("/platform-admin/audit-log?action=admin.removed&limit=100").set(asAdmin()).expect(200)).body;
    expect(log.data.find((r: { targetLabel: string }) => r.targetLabel === second.email)).toBeDefined();
  });

  test("a removal waits for the admins table lock instead of racing past it", async () => {
    // This is what makes "never zero admins" safe: remove() takes a row
    // lock on every admin first, so a concurrent removal queues behind it.
    const victim = await createTestPlatformAdmin();
    createdAdminIds.push(victim.id);

    const holder = new Client({ connectionString: process.env.DATABASE_PRIMARY_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev" });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM platform_admins ORDER BY id FOR UPDATE");

      let finished = false;
      const pending = http()
        .delete(`/platform-admin/admins/${victim.id}`)
        .set(asAdmin())
        .then((res) => {
          finished = true;
          return res;
        });
      await new Promise((r) => setTimeout(r, 400));
      expect(finished).toBe(false); // still blocked behind our lock

      await holder.query("COMMIT");
      expect((await pending).status).toBe(200);
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      await holder.end();
    }
  });

  test("two admins removing each other at the same instant both get a clean answer and the platform keeps an admin", async () => {
    // (With other admins in the table both removals are allowed; the point
    // is no deadlock, no 5xx, and the platform is never left empty. The
    // "last admin" decision itself is unit-tested in
    // platform-admin-team.service.spec.ts.)
    const a = await createTestPlatformAdmin();
    const b = await createTestPlatformAdmin();
    createdAdminIds.push(a.id, b.id);
    const sessionA = (await loginAdmin(a.email, a.password)).access!;
    const sessionB = (await loginAdmin(b.email, b.password)).access!;

    const [ra, rb] = await Promise.all([
      http().delete(`/platform-admin/admins/${b.id}`).set(asAdmin(sessionA)),
      http().delete(`/platform-admin/admins/${a.id}`).set(asAdmin(sessionB)),
    ]);

    for (const status of [ra.status, rb.status]) expect([200, 401, 409]).toContain(status);
    expect([ra.status, rb.status]).toContain(200);
    expect((await loginAdmin(admin.email, admin.password)).status).toBe(201);
  });
});

describe("change password", () => {
  test("verifies the current password, signs out other sessions, keeps this one", async () => {
    const me = await createTestPlatformAdmin();
    createdAdminIds.push(me.id);
    const first = await loginAdmin(me.email, me.password);
    const otherDevice = await loginAdmin(me.email, me.password);

    await http().post("/platform-admin/auth/change-password").set(asAdmin(first.access!)).send({ currentPassword: "wrong-password", newPassword: "brand-new-pass-1" }).expect(400);
    await http().post("/platform-admin/auth/change-password").set(asAdmin(first.access!)).send({ currentPassword: me.password, newPassword: me.password }).expect(400);
    await http().post("/platform-admin/auth/change-password").set(asAdmin(first.access!)).send({ currentPassword: me.password, newPassword: "short" }).expect(400);

    const res = await http().post("/platform-admin/auth/change-password").set(asAdmin(first.access!)).send({ currentPassword: me.password, newPassword: "brand-new-pass-1" }).expect(201);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    const freshAccess = extractCookie(cookies, PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE)!;
    expect(freshAccess).toBeDefined();

    // This browser carries on...
    await http().get("/platform-admin/auth/me").set(asAdmin(freshAccess)).expect(200);
    // ...every other session can no longer refresh...
    await http().post("/platform-admin/auth/refresh").set("Cookie", `${PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE}=${otherDevice.refresh}`).expect(401);
    await http().post("/platform-admin/auth/refresh").set("Cookie", `${PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE}=${first.refresh}`).expect(401);
    // ...and only the new password works.
    expect((await loginAdmin(me.email, me.password)).status).toBe(401);
    expect((await loginAdmin(me.email, "brand-new-pass-1")).status).toBe(201);

    const log = (await http().get("/platform-admin/audit-log?action=admin.password_changed&limit=100").set(asAdmin()).expect(200)).body;
    expect(log.data.find((r: { targetLabel: string }) => r.targetLabel === me.email)).toBeDefined();
  });
});
