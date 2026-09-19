import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { eq } from "drizzle-orm";
import request from "supertest";
import { CUSTOMER_ACCESS_TOKEN_COOKIE } from "../auth/auth-cookies";
import { DbRouter } from "../database/db-router";
import { outboxEvents } from "../database/schema";
import { bootstrapTestApp, cleanupTestTenant, createTestTenant, extractCookie, type TestTenant } from "../test-utils/bootstrap-app";
import { OTP_PROVIDER, type OtpProvider } from "../storefront/otp-provider";
import type { PaymentProvider } from "./payment-provider.interface";
import { PAYMENT_GATEWAY } from "./payment-provider.interface";

/**
 * Real Postgres, real HTTP layer (guards/DTOs/RLS all exercised, not
 * bypassed) — only StripeProvider's outbound network calls are faked, via
 * a FakePaymentGateway swapped in the same way CapturingOtpProvider is in
 * customer-auth.integration.spec.ts. No real Stripe credentials anywhere
 * in this file or CI.
 */
class FakePaymentGateway implements PaymentProvider {
  public createCheckoutSessionCalls = 0;
  public webhookSecret = "test-webhook-secret";
  private sessions = new Map<string, { url: string | null; payment_status: string; payment_intent: string }>();

  async createCheckoutSession(input: { amountCents: number; currency: string; receipt: string }) {
    this.createCheckoutSessionCalls += 1;
    const id = `cs_fake_${input.receipt}`;
    const url = `https://checkout.stripe.dev/fake/${id}`;
    this.sessions.set(id, { url, payment_status: "unpaid", payment_intent: `pi_fake_${input.receipt}` });
    return { providerSessionId: id, url };
  }

  async fetchCheckoutSession(providerSessionId: string) {
    const session = this.sessions.get(providerSessionId);
    return { id: providerSessionId, url: session?.url ?? null, payment_status: session?.payment_status } as never;
  }

  constructWebhookEvent(input: { rawBody: string; signature: string }) {
    if (input.signature !== this.webhookSecret) throw new Error("invalid signature");
    return JSON.parse(input.rawBody);
  }

  async refund(): Promise<never> {
    throw new Error("not used in this suite");
  }

  async createConnectAccount() {
    return { accountId: "acct_fake_linked" };
  }

  async createAccountLink(accountId: string) {
    return { url: `https://connect.stripe.dev/fake/${accountId}` };
  }

  async getConnectAccountStatus() {
    // Activated immediately — this suite is testing the payment flow
    // itself, not Stripe's own (external, asynchronous) account review
    // timing, which is unit-tested separately at the pure-logic level.
    return { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true };
  }

  /** Test-only helper — simulates the customer completing payment on
   * Stripe's hosted page, which in reality flips payment_status server-side
   * on Stripe's end before the webhook fires. */
  markPaid(providerSessionId: string) {
    const session = this.sessions.get(providerSessionId);
    if (session) session.payment_status = "paid";
  }
}

let app: INestApplication;
let gateway: FakePaymentGateway;
let otp: { lastSent: { phone: string; code: string } | null };
let tenant: TestTenant & { ownerEmail: string; ownerPassword: string };

function randomPhone(): string {
  return `+1888${Math.floor(1000000 + Math.random() * 8999999)}`;
}

async function staffLogin(): Promise<string> {
  const loginRes = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);
  return extractCookie(loginRes.headers["set-cookie"] as unknown as string[], "fk_access_token")!;
}

async function createStaffProduct(): Promise<string> {
  const staffAccess = await staffLogin();
  const productRes = await request(app.getHttpServer())
    .post("/products")
    .set("Cookie", `fk_access_token=${staffAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .send({ name: "Payment Test Product", slug: `payment-test-${randomUUID().slice(0, 8)}`, priceCents: 50000, status: "active" })
    .expect(201);
  return productRes.body.id;
}

/** The "store admin connects and activates payments" flow, as a test
 * setup step — everything in this suite is testing the checkout/webhook
 * flow itself, which requires payments already being enabled for the
 * tenant (PaymentsService.initiatePayment()'s own gate). "Connect Stripe"
 * is a single call now — no KYC form, Stripe's own hosted onboarding
 * collects that (see ADR 0006's Stripe migration addendum) — followed by
 * the same "Refresh status" call merchant-admin's UI makes. */
async function activatePayments(): Promise<void> {
  const staffAccess = await staffLogin();
  const auth = { Cookie: `fk_access_token=${staffAccess}`, "X-Tenant-Id": tenant.slug };
  await request(app.getHttpServer()).post("/payment-accounts/connect").set(auth).expect(201);
  await request(app.getHttpServer()).post("/payment-accounts/refresh").set(auth).expect(201);
}

async function createPayableOrder(): Promise<{ orderId: string; customerAccess: string }> {
  const productId = await createStaffProduct();
  const phone = randomPhone();

  await request(app.getHttpServer()).post("/storefront/auth/otp/request").set("X-Tenant-Id", tenant.slug).send({ phone }).expect(201);
  const code = otp.lastSent!.code;
  const verifyRes = await request(app.getHttpServer())
    .post("/storefront/auth/otp/verify")
    .set("X-Tenant-Id", tenant.slug)
    .send({ phone, code })
    .expect(201);
  const customerAccess = extractCookie(verifyRes.headers["set-cookie"] as unknown as string[], CUSTOMER_ACCESS_TOKEN_COOKIE);

  await request(app.getHttpServer())
    .post("/storefront/cart/items")
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .send({ productId, quantity: 1 })
    .expect(201);

  const checkoutRes = await request(app.getHttpServer())
    .post("/storefront/orders/checkout")
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(201);

  return { orderId: checkoutRes.body.id, customerAccess: customerAccess! };
}

function pay(orderId: string, customerAccess: string, idempotencyKey: string) {
  return request(app.getHttpServer())
    .post(`/storefront/orders/${orderId}/pay`)
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .send({ idempotencyKey, returnUrl: `https://${tenant.slug}.folkshops.test/orders/${orderId}` });
}

beforeAll(async () => {
  gateway = new FakePaymentGateway();
  const otpProvider: OtpProvider & { lastSent: { phone: string; code: string } | null } = {
    lastSent: null,
    async send(phone: string, code: string) {
      this.lastSent = { phone, code };
    },
  };
  otp = otpProvider;
  app = await bootstrapTestApp((builder) =>
    builder
      .overrideProvider(OTP_PROVIDER)
      .useValue(otpProvider)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true }),
  );
  tenant = await createTestTenant(app);
  await activatePayments();
});

afterAll(async () => {
  await cleanupTestTenant(tenant.id);
  await app.close();
});

test("POST /pay is idempotent — a retried Idempotency-Key never calls the provider twice", async () => {
  const { orderId, customerAccess } = await createPayableOrder();
  const callsBefore = gateway.createCheckoutSessionCalls;
  const idempotencyKey = randomUUID();

  const first = await pay(orderId, customerAccess, idempotencyKey).expect(201);
  const second = await pay(orderId, customerAccess, idempotencyKey).expect(201);

  expect(gateway.createCheckoutSessionCalls).toBe(callsBefore + 1);
  expect(second.body.url).toBe(first.body.url);
  expect(second.body.paymentId).toBe(first.body.paymentId);
});

test("a genuinely concurrent double-submit of the same key still only calls the provider once", async () => {
  const { orderId, customerAccess } = await createPayableOrder();
  const callsBefore = gateway.createCheckoutSessionCalls;
  const idempotencyKey = randomUUID();

  const [a, b] = await Promise.all([pay(orderId, customerAccess, idempotencyKey), pay(orderId, customerAccess, idempotencyKey)]);
  expect([a.status, b.status]).toEqual([201, 201]);
  expect(gateway.createCheckoutSessionCalls).toBe(callsBefore + 1);
  expect(a.body.url).toBe(b.body.url);
});

test("webhook: checkout.session.completed captures the order, a duplicate delivery is a no-op", async () => {
  const { orderId, customerAccess } = await createPayableOrder();
  const idempotencyKey = randomUUID();

  const payRes = await pay(orderId, customerAccess, idempotencyKey).expect(201);
  const sessionId = `cs_fake_${payRes.body.paymentId}`;
  gateway.markPaid(sessionId);

  const eventBody = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: "checkout.session.completed",
    data: { object: { id: sessionId, payment_status: "paid", payment_intent: `pi_fake_${payRes.body.paymentId}` } },
  });

  await request(app.getHttpServer())
    .post("/payments/webhooks/stripe")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", gateway.webhookSecret)
    .send(eventBody)
    .expect(200);

  const orderAfterFirst = await request(app.getHttpServer())
    .get(`/storefront/orders/${orderId}`)
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(200);
  expect(orderAfterFirst.body.status).toBe("paid");

  // The outbox row is what core-api itself is responsible for — apps/workers
  // (a separate process, not booted by this test) is what turns it into a
  // real notification; see outbox-events.ts's own comment on the
  // durability split between the two. Filtered by this test's own orderId
  // (via the JSONB payload), not a blanket tenant-wide count — every test
  // in this file shares one tenant, so other tests' outbox rows coexist.
  const dbRouter = app.get(DbRouter);
  const outboxRowsForOrder = () =>
    dbRouter
      .read("strong", (db) => db.select().from(outboxEvents).where(eq(outboxEvents.tenantId, tenant.id)))
      .then((rows) => rows.filter((row) => (row.payload as { orderId?: string }).orderId === orderId));

  const [outboxRow] = await outboxRowsForOrder();
  expect(outboxRow).toMatchObject({ eventType: "order.paid", payload: { orderId } });
  expect(outboxRow.processedAt).toBeNull();

  // Redelivery of the exact same event — must not error, must not change
  // anything further (there's nothing left to change, but this proves the
  // idempotency path returns 200 rather than erroring on the second call).
  await request(app.getHttpServer())
    .post("/payments/webhooks/stripe")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", gateway.webhookSecret)
    .send(eventBody)
    .expect(200);

  // The redelivery must not create a second outbox row — it's inside the
  // same paymentEvents-dedup guard as the rest of applyPaymentResult().
  expect(await outboxRowsForOrder()).toHaveLength(1);
});

test("webhook: checkout.session.expired marks the order payment_failed", async () => {
  const { orderId, customerAccess } = await createPayableOrder();
  const idempotencyKey = randomUUID();

  const payRes = await pay(orderId, customerAccess, idempotencyKey).expect(201);
  const sessionId = `cs_fake_${payRes.body.paymentId}`;

  const eventBody = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: "checkout.session.expired",
    data: { object: { id: sessionId } },
  });

  await request(app.getHttpServer())
    .post("/payments/webhooks/stripe")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", gateway.webhookSecret)
    .send(eventBody)
    .expect(200);

  const orderAfter = await request(app.getHttpServer())
    .get(`/storefront/orders/${orderId}`)
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(200);
  expect(orderAfter.body.status).toBe("payment_failed");

  // No notification for a failed payment — only orderStatus === "paid"
  // writes to the outbox (see PaymentsService.applyPaymentResult()).
  // Filtered by this test's own orderId, not a blanket tenant-wide count —
  // every test in this file shares one tenant, so other tests' outbox rows
  // are still present.
  const dbRouter = app.get(DbRouter);
  const outboxRowsForOrder = await dbRouter
    .read("strong", (db) => db.select().from(outboxEvents).where(eq(outboxEvents.tenantId, tenant.id)))
    .then((rows) => rows.filter((row) => (row.payload as { orderId?: string }).orderId === orderId));
  expect(outboxRowsForOrder).toHaveLength(0);
});

test("webhook: an invalid signature is rejected before anything is processed", async () => {
  const eventBody = JSON.stringify({
    id: "evt_x",
    type: "checkout.session.completed",
    data: { object: { id: "cs_x", payment_status: "paid" } },
  });

  await request(app.getHttpServer())
    .post("/payments/webhooks/stripe")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", "not-the-real-secret")
    .send(eventBody)
    .expect(401);
});
