import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { bootstrapTestApp, cleanupTestTenant, createTestTenant, extractCookie, type TestTenant } from "../test-utils/bootstrap-app";
import type { BillingProvider } from "./billing-provider.interface";
import { BILLING_GATEWAY } from "./billing-provider.interface";

/**
 * Real Postgres, real HTTP layer (guards/DTOs/RLS all exercised) — only
 * StripeBillingProvider's outbound network calls are faked, same pattern
 * as FakePaymentGateway in storefront-payments.integration.spec.ts. No
 * real Stripe credentials anywhere in this file or CI.
 */
class FakeBillingGateway implements BillingProvider {
  public createCheckoutSessionCalls = 0;
  public webhookSecret = "test-subscriptions-webhook-secret";

  async createCustomer(email: string, tenantId: string) {
    return { customerId: `cus_fake_${tenantId}` };
  }

  async createCheckoutSession(input: { stripeCustomerId: string; planId: string }) {
    this.createCheckoutSessionCalls += 1;
    const id = `cs_fake_${randomUUID()}`;
    return { providerSessionId: id, url: `https://checkout.stripe.dev/fake/${id}` };
  }

  async createPortalSession(stripeCustomerId: string) {
    return { url: `https://billing.stripe.dev/fake/${stripeCustomerId}` };
  }

  async updateSubscriptionPrice(): Promise<void> {}

  async cancelSubscription(): Promise<void> {}

  constructWebhookEvent(input: { rawBody: string; signature: string }) {
    if (input.signature !== this.webhookSecret) throw new Error("invalid signature");
    return JSON.parse(input.rawBody);
  }
}

let app: INestApplication;
let gateway: FakeBillingGateway;
// Cleaned up in afterAll rather than inline at the end of each test — a
// failed assertion partway through a test used to skip its own cleanup
// call entirely, leaking a tenant (and, for the limit test, a plan row)
// into the shared dev DB. Caught live: a failed early version of the
// limit test left a stray plan visible on the real /pricing page.
const createdTenantIds: string[] = [];
const createdPlanIds: string[] = [];

async function registerTenant(planSlug?: string) {
  const tenant = await createTestTenant(app, planSlug);
  createdTenantIds.push(tenant.id);
  return tenant;
}

function rawPgUrl(): string {
  return process.env.DATABASE_PRIMARY_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";
}

/** Ensures basic/standard/advanced have a stripe_price_id set for this test run, regardless of whether scripts/bootstrap-stripe-plans.ts has ever run against this DB (CI won't — it never calls real Stripe). */
async function ensurePaidPlansHavePrices(): Promise<void> {
  const client = new Client({ connectionString: rawPgUrl() });
  await client.connect();
  try {
    await client.query(
      "UPDATE plans SET stripe_price_id = 'price_fake_' || slug WHERE price_cents > 0 AND stripe_price_id IS NULL",
    );
  } finally {
    await client.end();
  }
}

/** Inserts a disposable plan with a tiny product limit, for the limit-enforcement test — never touches the shared free/basic/standard/advanced rows. */
async function createTestPlan(maxProducts: number): Promise<{ id: string; slug: string }> {
  const slug = `test-plan-${randomUUID().slice(0, 8)}`;
  const client = new Client({ connectionString: rawPgUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO plans (slug, name, price_cents, max_products) VALUES ($1, $1, 0, $2) RETURNING id",
      [slug, maxProducts],
    );
    createdPlanIds.push(rows[0].id);
    return { id: rows[0].id, slug };
  } finally {
    await client.end();
  }
}

async function staffLogin(tenant: TestTenant & { ownerEmail: string; ownerPassword: string }): Promise<string> {
  const res = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);
  return extractCookie(res.headers["set-cookie"] as unknown as string[], "fk_access_token")!;
}

beforeAll(async () => {
  gateway = new FakeBillingGateway();
  app = await bootstrapTestApp((builder) => builder.overrideProvider(BILLING_GATEWAY).useValue(gateway));
  await ensurePaidPlansHavePrices();
});

afterAll(async () => {
  // Tenants before plans — subscriptions.planId FKs plans.id, and
  // cleanupTestTenant() deletes the subscriptions row as part of tearing
  // down a tenant.
  for (const tenantId of createdTenantIds) {
    await cleanupTestTenant(tenantId);
  }
  const client = new Client({ connectionString: rawPgUrl() });
  await client.connect();
  try {
    for (const planId of createdPlanIds) {
      await client.query("DELETE FROM plans WHERE id = $1", [planId]);
    }
  } finally {
    await client.end();
  }
  await app.close();
});

test("registering on the free plan creates an active subscription with no Stripe calls", async () => {
  const callsBefore = gateway.createCheckoutSessionCalls;
  const tenant = await registerTenant(); // no planSlug -> defaults to "free"

  expect(tenant.checkoutUrl).toBeUndefined();
  expect(gateway.createCheckoutSessionCalls).toBe(callsBefore);

  const accessToken = await staffLogin(tenant);
  const me = await request(app.getHttpServer())
    .get("/subscriptions/me")
    .set("X-Tenant-Id", tenant.slug)
    .set("Cookie", `fk_access_token=${accessToken}`)
    .expect(200);

  expect(me.body.plan.slug).toBe("free");
  expect(me.body.subscription.status).toBe("active");
});

test("registering on a paid plan creates an incomplete subscription and returns a real checkout url", async () => {
  const tenant = await registerTenant("basic");

  expect(tenant.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.dev\/fake\//);

  const accessToken = await staffLogin(tenant);
  const me = await request(app.getHttpServer())
    .get("/subscriptions/me")
    .set("X-Tenant-Id", tenant.slug)
    .set("Cookie", `fk_access_token=${accessToken}`)
    .expect(200);

  expect(me.body.plan.slug).toBe("basic");
  expect(me.body.subscription.status).toBe("incomplete");
  expect(me.body.subscription.stripeCustomerId).toBe(`cus_fake_${tenant.id}`);
});

test("webhook activates a subscription on checkout.session.completed", async () => {
  const tenant = await registerTenant("basic");

  const payload = JSON.stringify({
    id: "evt_test",
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "subscription",
        customer: `cus_fake_${tenant.id}`,
        subscription: "sub_fake_12345",
        metadata: {},
      },
    },
  });

  await request(app.getHttpServer())
    .post("/subscriptions/webhooks/stripe")
    .set("stripe-signature", gateway.webhookSecret)
    .set("Content-Type", "application/json")
    .send(payload)
    .expect(200);

  const accessToken = await staffLogin(tenant);
  const me = await request(app.getHttpServer())
    .get("/subscriptions/me")
    .set("X-Tenant-Id", tenant.slug)
    .set("Cookie", `fk_access_token=${accessToken}`)
    .expect(200);

  expect(me.body.subscription.status).toBe("active");
  expect(me.body.subscription.stripeSubscriptionId).toBe("sub_fake_12345");
});

test("a webhook with an invalid signature is rejected before anything changes", async () => {
  const tenant = await registerTenant("basic");

  await request(app.getHttpServer())
    .post("/subscriptions/webhooks/stripe")
    .set("stripe-signature", "not-the-real-secret")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ type: "checkout.session.completed", data: { object: {} } }))
    .expect(401);

  const accessToken = await staffLogin(tenant);
  const me = await request(app.getHttpServer())
    .get("/subscriptions/me")
    .set("X-Tenant-Id", tenant.slug)
    .set("Cookie", `fk_access_token=${accessToken}`)
    .expect(200);

  expect(me.body.subscription.status).toBe("incomplete"); // unchanged
});

test("changing from free to a paid plan returns a checkout url and carries the target plan via metadata", async () => {
  const tenant = await registerTenant(); // free
  const accessToken = await staffLogin(tenant);

  const res = await request(app.getHttpServer())
    .post("/subscriptions/change-plan")
    .set("X-Tenant-Id", tenant.slug)
    .set("Cookie", `fk_access_token=${accessToken}`)
    .send({ planSlug: "standard" })
    .expect(201);

  expect(res.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.dev\/fake\//);

  // Still "free" in the DB until the webhook confirms payment — changePlan()
  // never writes the new planId itself for the free->paid path (see
  // subscriptions.service.ts's own comment on why the webhook must).
  const me = await request(app.getHttpServer())
    .get("/subscriptions/me")
    .set("X-Tenant-Id", tenant.slug)
    .set("Cookie", `fk_access_token=${accessToken}`)
    .expect(200);
  expect(me.body.plan.slug).toBe("free");
});

test("product creation is blocked once a plan's product limit is reached", async () => {
  const plan = await createTestPlan(2);
  const tenant = await registerTenant(plan.slug);
  const accessToken = await staffLogin(tenant);

  const createProduct = (name: string) =>
    request(app.getHttpServer())
      .post("/products")
      .set("X-Tenant-Id", tenant.slug)
      .set("Cookie", `fk_access_token=${accessToken}`)
      .send({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), priceCents: 1000 });

  await createProduct("Product A").expect(201);
  await createProduct("Product B").expect(201);

  const blocked = await createProduct("Product C").expect(403);
  expect(blocked.body.message).toMatch(/plan allows up to 2 products/i);
});
