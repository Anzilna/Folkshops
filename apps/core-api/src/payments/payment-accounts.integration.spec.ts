import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import request from "supertest";
import { bootstrapTestApp, cleanupTestTenant, createTestTenant, type TestTenant } from "../test-utils/bootstrap-app";
import type { PaymentProvider } from "./payment-provider.interface";
import { PAYMENT_GATEWAY } from "./payment-provider.interface";

/**
 * Real Postgres, real HTTP layer, real RLS — only StripeProvider's
 * outbound network calls are faked, same discipline as
 * storefront-payments.integration.spec.ts. Covers the "Connect Stripe"
 * flow (payment-accounts.controller.ts) specifically: tenant isolation on
 * payment_accounts, and that connect()/refresh() call the gateway methods
 * they're supposed to. The idempotency/webhook side of payments is
 * already covered by storefront-payments.integration.spec.ts and isn't
 * duplicated here.
 */
class FakePaymentGateway implements PaymentProvider {
  public createConnectAccountCalls = 0;
  public createConnectAccountEmails: string[] = [];
  public createAccountLinkCalls: Array<{ accountId: string; refreshUrl: string; returnUrl: string }> = [];
  public nextStatus = { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false };

  async createCheckoutSession(): Promise<never> {
    throw new Error("not used in this suite");
  }

  async fetchCheckoutSession(): Promise<never> {
    throw new Error("not used in this suite");
  }

  constructWebhookEvent(): never {
    throw new Error("not used in this suite");
  }

  async refund(): Promise<never> {
    throw new Error("not used in this suite");
  }

  async createConnectAccount(contactEmail: string) {
    this.createConnectAccountCalls += 1;
    this.createConnectAccountEmails.push(contactEmail);
    return { accountId: "acct_fake_linked" };
  }

  async createAccountLink(accountId: string, refreshUrl: string, returnUrl: string) {
    this.createAccountLinkCalls.push({ accountId, refreshUrl, returnUrl });
    return { url: `https://connect.stripe.dev/fake/${accountId}` };
  }

  async getConnectAccountStatus() {
    return this.nextStatus;
  }
}

let app: INestApplication;
let gateway: FakePaymentGateway;
let tenantA: TestTenant & { ownerEmail: string; ownerPassword: string };
let tenantB: TestTenant & { ownerEmail: string; ownerPassword: string };

async function staffLogin(tenant: TestTenant & { ownerEmail: string; ownerPassword: string }): Promise<string> {
  const res = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);
  const raw = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("fk_access_token="))!;
  return raw.split(";")[0]!.split("=")[1]!;
}

beforeAll(async () => {
  gateway = new FakePaymentGateway();
  app = await bootstrapTestApp((builder) =>
    builder
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true }),
  );
  tenantA = await createTestTenant(app);
  tenantB = await createTestTenant(app);
});

afterAll(async () => {
  await cleanupTestTenant(tenantA.id);
  await cleanupTestTenant(tenantB.id);
  await app.close();
});

test("Connect Stripe: first call creates a bare Connect account and returns a hosted onboarding url", async () => {
  const access = await staffLogin(tenantA);

  const res = await request(app.getHttpServer())
    .post("/payment-accounts/connect")
    .set("Cookie", `fk_access_token=${access}`)
    .set("X-Tenant-Id", tenantA.slug)
    .expect(201);

  expect(res.body.url).toBe("https://connect.stripe.dev/fake/acct_fake_linked");
  expect(gateway.createConnectAccountCalls).toBe(1);
  // v2 account creation requires a contact_email (confirmed live against
  // Stripe) — the logged-in staff member's own email, not a new form field.
  expect(gateway.createConnectAccountEmails).toEqual([tenantA.ownerEmail]);

  const meRes = await request(app.getHttpServer())
    .get("/payment-accounts/me")
    .set("Cookie", `fk_access_token=${access}`)
    .set("X-Tenant-Id", tenantA.slug)
    .expect(200);
  expect(meRes.body.linkedAccountId).toBe("acct_fake_linked");
  expect(meRes.body.live).toBe(false);
});

test("Connect Stripe: calling again for an already-connected tenant reuses the account and just mints a fresh link", async () => {
  const access = await staffLogin(tenantA);
  const callsBefore = gateway.createConnectAccountCalls;

  const res = await request(app.getHttpServer())
    .post("/payment-accounts/connect")
    .set("Cookie", `fk_access_token=${access}`)
    .set("X-Tenant-Id", tenantA.slug)
    .expect(201);

  expect(res.body.url).toBe("https://connect.stripe.dev/fake/acct_fake_linked");
  expect(gateway.createConnectAccountCalls).toBe(callsBefore); // no second Stripe account created
});

test("refresh 404s with no connected account yet, then persists the gateway's reported flags once one exists", async () => {
  const accessB = await staffLogin(tenantB);

  await request(app.getHttpServer())
    .post("/payment-accounts/refresh")
    .set("Cookie", `fk_access_token=${accessB}`)
    .set("X-Tenant-Id", tenantB.slug)
    .expect(404);

  await request(app.getHttpServer())
    .post("/payment-accounts/connect")
    .set("Cookie", `fk_access_token=${accessB}`)
    .set("X-Tenant-Id", tenantB.slug)
    .expect(201);

  gateway.nextStatus = { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true };
  const refreshRes = await request(app.getHttpServer())
    .post("/payment-accounts/refresh")
    .set("Cookie", `fk_access_token=${accessB}`)
    .set("X-Tenant-Id", tenantB.slug)
    .expect(201);

  expect(refreshRes.body.live).toBe(true);
  expect(refreshRes.body.payoutsEnabled).toBe(true);
  expect(refreshRes.body.detailsSubmitted).toBe(true);
  expect(refreshRes.body.activatedAt).not.toBeNull();
});

test("store cache invalidation: refreshStatus() flipping `live` is reflected in GET /storefront/store immediately, not after CACHE_STORE_TTL_SECONDS", async () => {
  const before = await request(app.getHttpServer()).get("/storefront/store").set("X-Tenant-Id", tenantB.slug).expect(200);
  // tenantB was already connected + live from the test above — this call
  // itself populates (or confirms already-populated) the store cache.
  expect(before.body.paymentsEnabled).toBe(true);

  gateway.nextStatus = { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true };
  const accessB = await staffLogin(tenantB);
  await request(app.getHttpServer())
    .post("/payment-accounts/refresh")
    .set("Cookie", `fk_access_token=${accessB}`)
    .set("X-Tenant-Id", tenantB.slug)
    .expect(201);

  // If the store cache weren't invalidated here, this would still read
  // the stale `paymentsEnabled: true` cached by the call above.
  const after = await request(app.getHttpServer()).get("/storefront/store").set("X-Tenant-Id", tenantB.slug).expect(200);
  expect(after.body.paymentsEnabled).toBe(false);
});

test("unauthorized tenant cannot read, connect for, or refresh another tenant's payment account", async () => {
  const accessB = await staffLogin(tenantB);

  // tenantA already has a connected account (from the tests above) —
  // scoping every call as tenantB's own token but tenantA's host header
  // (real staff session, real TenantMatchGuard) must never reach it.
  await request(app.getHttpServer())
    .get("/payment-accounts/me")
    .set("Cookie", `fk_access_token=${accessB}`)
    .set("X-Tenant-Id", tenantA.slug)
    .expect(403);

  await request(app.getHttpServer())
    .post("/payment-accounts/connect")
    .set("Cookie", `fk_access_token=${accessB}`)
    .set("X-Tenant-Id", tenantA.slug)
    .expect(403);

  await request(app.getHttpServer())
    .post("/payment-accounts/refresh")
    .set("Cookie", `fk_access_token=${accessB}`)
    .set("X-Tenant-Id", tenantA.slug)
    .expect(403);
});

test("RLS: tenant A's own payment-accounts/me returns tenant A's row, not tenant B's", async () => {
  const accessA = await staffLogin(tenantA);

  const res = await request(app.getHttpServer())
    .get("/payment-accounts/me")
    .set("Cookie", `fk_access_token=${accessA}`)
    .set("X-Tenant-Id", tenantA.slug)
    .expect(200);

  expect(res.body.linkedAccountId).toBe("acct_fake_linked");
  expect(res.body.tenantId).toBe(tenantA.id);
});
