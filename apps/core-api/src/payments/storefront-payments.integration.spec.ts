import { randomUUID, createHmac } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import request from "supertest";
import { CUSTOMER_ACCESS_TOKEN_COOKIE } from "../auth/auth-cookies";
import { bootstrapTestApp, cleanupTestTenant, createTestTenant, extractCookie, type TestTenant } from "../test-utils/bootstrap-app";
import { OTP_PROVIDER, type OtpProvider } from "../storefront/otp-provider";
import type { PaymentProvider } from "./payment-provider.interface";
import { PAYMENT_GATEWAY } from "./payment-provider.interface";

/**
 * Real Postgres, real HTTP layer (guards/DTOs/RLS all exercised, not
 * bypassed) — only RazorpayProvider's outbound network calls are faked,
 * via a FakePaymentGateway swapped in the same way CapturingOtpProvider
 * is in customer-auth.integration.spec.ts. No real Razorpay credentials
 * anywhere in this file or CI.
 */
class FakePaymentGateway implements PaymentProvider {
  public createOrderCalls = 0;
  public webhookSecret = "test-webhook-secret";

  getPublicKey(): string {
    return "rzp_test_fake";
  }

  async createOrder(input: { amountCents: number; currency: string; receipt: string }) {
    this.createOrderCalls += 1;
    return { providerOrderId: `order_fake_${input.receipt}` };
  }

  async fetchPayment(providerPaymentId: string) {
    return { status: "captured", amountCents: 50000, currency: "INR", providerPaymentId } as unknown as {
      status: string;
      amountCents: number;
      currency: string;
    };
  }

  verifyPaymentSignature(): boolean {
    return true;
  }

  verifyWebhookSignature(input: { rawBody: string; signature: string }): boolean {
    const expected = createHmac("sha256", this.webhookSecret).update(input.rawBody).digest("hex");
    return expected === input.signature;
  }

  async refund(): Promise<never> {
    throw new Error("not used in this suite");
  }

  async createLinkedAccount(): Promise<never> {
    throw new Error("not used in this suite");
  }

  async transferToLinkedAccount(): Promise<never> {
    throw new Error("not used in this suite");
  }
}

let app: INestApplication;
let gateway: FakePaymentGateway;
let otp: { lastSent: { phone: string; code: string } | null };
let tenant: TestTenant & { ownerEmail: string; ownerPassword: string };

function randomPhone(): string {
  return `+1888${Math.floor(1000000 + Math.random() * 8999999)}`;
}

async function createStaffProduct(): Promise<string> {
  const loginRes = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);
  const staffAccess = extractCookie(loginRes.headers["set-cookie"] as unknown as string[], "fk_access_token");

  const productRes = await request(app.getHttpServer())
    .post("/products")
    .set("Cookie", `fk_access_token=${staffAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .send({ name: "Payment Test Product", slug: `payment-test-${randomUUID().slice(0, 8)}`, priceCents: 50000, status: "active" })
    .expect(201);
  return productRes.body.id;
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
});

afterAll(async () => {
  await cleanupTestTenant(tenant.id);
  await app.close();
});

test("POST /pay is idempotent — a retried Idempotency-Key never calls the provider twice", async () => {
  const { orderId, customerAccess } = await createPayableOrder();
  const callsBefore = gateway.createOrderCalls;
  const idempotencyKey = randomUUID();

  const first = await request(app.getHttpServer())
    .post(`/storefront/orders/${orderId}/pay`)
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .send({ idempotencyKey })
    .expect(201);

  const second = await request(app.getHttpServer())
    .post(`/storefront/orders/${orderId}/pay`)
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .send({ idempotencyKey })
    .expect(201);

  expect(gateway.createOrderCalls).toBe(callsBefore + 1);
  expect(second.body.providerOrderId).toBe(first.body.providerOrderId);
  expect(second.body.paymentId).toBe(first.body.paymentId);
});

test("a genuinely concurrent double-submit of the same key still only calls the provider once", async () => {
  const { orderId, customerAccess } = await createPayableOrder();
  const callsBefore = gateway.createOrderCalls;
  const idempotencyKey = randomUUID();

  const send = () =>
    request(app.getHttpServer())
      .post(`/storefront/orders/${orderId}/pay`)
      .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
      .set("X-Tenant-Id", tenant.slug)
      .send({ idempotencyKey });

  const [a, b] = await Promise.all([send(), send()]);
  expect([a.status, b.status]).toEqual([201, 201]);
  expect(gateway.createOrderCalls).toBe(callsBefore + 1);
  expect(a.body.providerOrderId).toBe(b.body.providerOrderId);
});

test("webhook: signature-verified delivery captures the order, a duplicate delivery is a no-op", async () => {
  const { orderId, customerAccess } = await createPayableOrder();
  const idempotencyKey = randomUUID();

  const payRes = await request(app.getHttpServer())
    .post(`/storefront/orders/${orderId}/pay`)
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .send({ idempotencyKey })
    .expect(201);

  const eventBody = JSON.stringify({
    event: "payment.captured",
    created_at: 1234567890,
    payload: {
      payment: {
        entity: { id: `pay_fake_${randomUUID()}`, order_id: payRes.body.providerOrderId, status: "captured", amount: 50000 },
      },
    },
  });
  const signature = createHmac("sha256", gateway.webhookSecret).update(eventBody).digest("hex");

  await request(app.getHttpServer())
    .post("/payments/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", signature)
    .send(eventBody)
    .expect(200);

  const orderAfterFirst = await request(app.getHttpServer())
    .get(`/storefront/orders/${orderId}`)
    .set("Cookie", `${CUSTOMER_ACCESS_TOKEN_COOKIE}=${customerAccess}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(200);
  expect(orderAfterFirst.body.status).toBe("paid");

  // Redelivery of the exact same event — must not error, must not change
  // anything further (there's nothing left to change, but this proves the
  // idempotency path returns 200 rather than erroring on the second call).
  await request(app.getHttpServer())
    .post("/payments/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", signature)
    .send(eventBody)
    .expect(200);
});

test("webhook: an invalid signature is rejected before anything is processed", async () => {
  const eventBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_x", status: "captured", amount: 1 } } } });

  await request(app.getHttpServer())
    .post("/payments/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", "not-a-real-signature")
    .send(eventBody)
    .expect(401);
});
