import { createHmac } from "node:crypto";
import { InternalServerErrorException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { RazorpayProvider } from "./razorpay.provider";

// The real razorpay package makes real HTTP calls the moment orders.create
// (etc.) is invoked — never touched in this suite, or CI would need real
// credentials. ordersCreate/paymentsFetch/paymentsRefund are shared mock
// fns so each test can control what the "SDK" returns.
const ordersCreate = jest.fn();
const paymentsFetch = jest.fn();
const paymentsRefund = jest.fn();

jest.mock("razorpay", () =>
  jest.fn().mockImplementation(() => ({
    orders: { create: ordersCreate },
    payments: { fetch: paymentsFetch, refund: paymentsRefund },
  })),
);

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("RazorpayProvider", () => {
  beforeEach(() => {
    ordersCreate.mockReset();
    paymentsFetch.mockReset();
    paymentsRefund.mockReset();
  });

  describe("getPublicKey", () => {
    test("throws when RAZORPAY_KEY_ID isn't set", () => {
      const provider = new RazorpayProvider(makeConfig({}));
      expect(() => provider.getPublicKey()).toThrow(InternalServerErrorException);
    });

    test("returns the configured key id", () => {
      const provider = new RazorpayProvider(makeConfig({ RAZORPAY_KEY_ID: "rzp_test_abc" }));
      expect(provider.getPublicKey()).toBe("rzp_test_abc");
    });
  });

  describe("verifyPaymentSignature", () => {
    const config = makeConfig({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "secret123" });

    test("accepts a correctly computed signature", () => {
      const provider = new RazorpayProvider(config);
      const signature = createHmac("sha256", "secret123").update("order_1|pay_1").digest("hex");
      expect(
        provider.verifyPaymentSignature({ providerOrderId: "order_1", providerPaymentId: "pay_1", signature }),
      ).toBe(true);
    });

    test("rejects a tampered signature", () => {
      const provider = new RazorpayProvider(config);
      const signature = createHmac("sha256", "secret123").update("order_1|pay_1").digest("hex");
      expect(
        provider.verifyPaymentSignature({ providerOrderId: "order_1", providerPaymentId: "pay_2", signature }),
      ).toBe(false);
    });

    test("rejects a signature computed with the wrong secret", () => {
      const provider = new RazorpayProvider(config);
      const signature = createHmac("sha256", "wrong-secret").update("order_1|pay_1").digest("hex");
      expect(
        provider.verifyPaymentSignature({ providerOrderId: "order_1", providerPaymentId: "pay_1", signature }),
      ).toBe(false);
    });
  });

  describe("verifyWebhookSignature", () => {
    const config = makeConfig({
      RAZORPAY_KEY_ID: "rzp_test_abc",
      RAZORPAY_KEY_SECRET: "secret123",
      RAZORPAY_WEBHOOK_SECRET: "whsecret456",
    });

    test("accepts a signature computed over the exact raw body", () => {
      const provider = new RazorpayProvider(config);
      const rawBody = '{"event":"payment.captured"}';
      const signature = createHmac("sha256", "whsecret456").update(rawBody).digest("hex");
      expect(provider.verifyWebhookSignature({ rawBody, signature })).toBe(true);
    });

    test("rejects when the body doesn't match what was signed", () => {
      const provider = new RazorpayProvider(config);
      const signature = createHmac("sha256", "whsecret456").update('{"event":"payment.captured"}').digest("hex");
      expect(provider.verifyWebhookSignature({ rawBody: '{"event":"payment.failed"}', signature })).toBe(false);
    });

    test("throws when RAZORPAY_WEBHOOK_SECRET isn't set, distinct from a bad signature", () => {
      const provider = new RazorpayProvider(
        makeConfig({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "secret123" }),
      );
      expect(() => provider.verifyWebhookSignature({ rawBody: "{}", signature: "anything" })).toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("createOrder", () => {
    const config = makeConfig({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "secret123" });

    test("creates a plain order with no transfers when no linked account is given", async () => {
      ordersCreate.mockResolvedValue({ id: "order_abc" });
      const provider = new RazorpayProvider(config);

      const result = await provider.createOrder({ amountCents: 50000, currency: "INR", receipt: "payment-1" });

      expect(result).toEqual({ providerOrderId: "order_abc" });
      expect(ordersCreate).toHaveBeenCalledWith({ amount: 50000, currency: "INR", receipt: "payment-1" });
    });

    test("attaches a Route transfer when a linked account is given", async () => {
      ordersCreate.mockResolvedValue({ id: "order_xyz" });
      const provider = new RazorpayProvider(config);

      await provider.createOrder({
        amountCents: 50000,
        currency: "INR",
        receipt: "payment-2",
        linkedAccountId: "acc_merchant1",
      });

      expect(ordersCreate).toHaveBeenCalledWith({
        amount: 50000,
        currency: "INR",
        receipt: "payment-2",
        transfers: [{ account: "acc_merchant1", amount: 50000, currency: "INR" }],
      });
    });
  });
});
