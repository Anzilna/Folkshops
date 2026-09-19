import { InternalServerErrorException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { StripeProvider } from "./stripe.provider";

// The real stripe package makes real HTTP calls the moment
// checkout.sessions.create (etc.) is invoked — never touched in this
// suite, or CI would need real credentials. Shared mock fns so each test
// can control what the "SDK" returns, same discipline as the old
// razorpay.provider.spec.ts this replaces.
const checkoutSessionsCreate = jest.fn();
const checkoutSessionsRetrieve = jest.fn();
const accountsCreate = jest.fn();
const accountsRetrieve = jest.fn();
const accountLinksCreate = jest.fn();
const refundsCreate = jest.fn();
const webhooksConstructEvent = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: checkoutSessionsCreate, retrieve: checkoutSessionsRetrieve } },
    // v2 Core Accounts/AccountLinks — not v1's stripe.accounts/stripe.accountLinks.
    // See stripe.provider.ts's own comment for why (v1 account creation
    // isn't enabled on this platform's real Stripe account; v2 is what
    // Stripe now recommends for a new integration anyway).
    v2: { core: { accounts: { create: accountsCreate, retrieve: accountsRetrieve }, accountLinks: { create: accountLinksCreate } } },
    refunds: { create: refundsCreate },
    webhooks: { constructEvent: webhooksConstructEvent },
  })),
);

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("StripeProvider", () => {
  beforeEach(() => {
    checkoutSessionsCreate.mockReset();
    checkoutSessionsRetrieve.mockReset();
    accountsCreate.mockReset();
    accountsRetrieve.mockReset();
    accountLinksCreate.mockReset();
    refundsCreate.mockReset();
    webhooksConstructEvent.mockReset();
  });

  describe("createCheckoutSession", () => {
    const config = makeConfig({ STRIPE_SECRET_KEY: "sk_test_abc" });

    test("throws when STRIPE_SECRET_KEY isn't set", async () => {
      const provider = new StripeProvider(makeConfig({}));
      await expect(
        provider.createCheckoutSession({
          amountCents: 50000,
          currency: "aed",
          receipt: "pay-1",
          connectedAccountId: "acct_1",
          successUrl: "https://x.test/success",
          cancelUrl: "https://x.test/cancel",
          idempotencyKey: "key-1",
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    test("creates a destination-charge session with a single line item for the whole order total", async () => {
      checkoutSessionsCreate.mockResolvedValue({ id: "cs_abc", url: "https://checkout.stripe.com/c/pay/cs_abc" });
      const provider = new StripeProvider(config);

      const result = await provider.createCheckoutSession({
        amountCents: 50000,
        currency: "aed",
        receipt: "pay-1",
        connectedAccountId: "acct_merchant1",
        successUrl: "https://x.test/success",
        cancelUrl: "https://x.test/cancel",
        idempotencyKey: "key-1",
      });

      expect(result).toEqual({ providerSessionId: "cs_abc", url: "https://checkout.stripe.com/c/pay/cs_abc" });
      const [params, options] = checkoutSessionsCreate.mock.calls[0];
      expect(params.mode).toBe("payment");
      expect(params.client_reference_id).toBe("pay-1");
      expect(params.success_url).toBe("https://x.test/success");
      expect(params.cancel_url).toBe("https://x.test/cancel");
      expect(params.line_items).toEqual([
        { quantity: 1, price_data: { currency: "aed", unit_amount: 50000, product_data: { name: "Order pay-1" } } },
      ]);
      expect(params.payment_intent_data).toEqual({ transfer_data: { destination: "acct_merchant1" } });
      expect(options).toEqual({ idempotencyKey: "key-1" });
    });

    test("throws when Stripe returns a session with no url", async () => {
      checkoutSessionsCreate.mockResolvedValue({ id: "cs_abc", url: null });
      const provider = new StripeProvider(config);

      await expect(
        provider.createCheckoutSession({
          amountCents: 50000,
          currency: "aed",
          receipt: "pay-1",
          connectedAccountId: "acct_1",
          successUrl: "https://x.test/success",
          cancelUrl: "https://x.test/cancel",
          idempotencyKey: "key-1",
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("constructWebhookEvent", () => {
    const config = makeConfig({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_123" });

    test("delegates to stripe.webhooks.constructEvent with the raw body/signature/secret", () => {
      const fakeEvent = { id: "evt_1", type: "checkout.session.completed" };
      webhooksConstructEvent.mockReturnValue(fakeEvent);
      const provider = new StripeProvider(config);

      const result = provider.constructWebhookEvent({ rawBody: '{"id":"evt_1"}', signature: "t=1,v1=abc" });

      expect(result).toBe(fakeEvent);
      expect(webhooksConstructEvent).toHaveBeenCalledWith('{"id":"evt_1"}', "t=1,v1=abc", "whsec_123");
    });

    test("propagates a signature verification failure rather than swallowing it", () => {
      webhooksConstructEvent.mockImplementation(() => {
        throw new Error("No signatures found matching the expected signature for payload");
      });
      const provider = new StripeProvider(config);

      expect(() => provider.constructWebhookEvent({ rawBody: "{}", signature: "bad" })).toThrow();
    });

    test("throws when STRIPE_WEBHOOK_SECRET isn't set, distinct from a bad signature", () => {
      const provider = new StripeProvider(makeConfig({ STRIPE_SECRET_KEY: "sk_test_abc" }));
      expect(() => provider.constructWebhookEvent({ rawBody: "{}", signature: "anything" })).toThrow(
        InternalServerErrorException,
      );
      expect(webhooksConstructEvent).not.toHaveBeenCalled();
    });
  });

  describe("Connect account lifecycle", () => {
    const config = makeConfig({ STRIPE_SECRET_KEY: "sk_test_abc" });

    test("createConnectAccount creates a v2 Express/recipient account with just the staff member's email — no prefilled KYC fields", async () => {
      accountsCreate.mockResolvedValue({ id: "acct_new" });
      const provider = new StripeProvider(config);

      const result = await provider.createConnectAccount("owner@store.test");

      expect(result).toEqual({ accountId: "acct_new" });
      expect(accountsCreate).toHaveBeenCalledWith({
        dashboard: "express",
        contact_email: "owner@store.test",
        identity: { country: "AE" },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
        defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
      });
    });

    test("createAccountLink requests account_onboarding targeting the recipient configuration", async () => {
      accountLinksCreate.mockResolvedValue({ url: "https://connect.stripe.com/setup/e/acct_1/xyz" });
      const provider = new StripeProvider(config);

      const result = await provider.createAccountLink("acct_1", "https://admin.test/refresh", "https://admin.test/return");

      expect(result).toEqual({ url: "https://connect.stripe.com/setup/e/acct_1/xyz" });
      expect(accountLinksCreate).toHaveBeenCalledWith({
        account: "acct_1",
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["recipient"],
            refresh_url: "https://admin.test/refresh",
            return_url: "https://admin.test/return",
          },
        },
      });
    });

    describe("getConnectAccountStatus", () => {
      test("requests the fields v2 hides by default, and maps capability status to the provider-agnostic shape", async () => {
        accountsRetrieve.mockResolvedValue({
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: { stripe_transfers: { status: "active" }, payouts: { status: "pending" } },
              },
            },
          },
          requirements: { entries: [] },
        });
        const provider = new StripeProvider(config);

        const result = await provider.getConnectAccountStatus("acct_1");

        expect(result).toEqual({ chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true });
        expect(accountsRetrieve).toHaveBeenCalledWith("acct_1", { include: ["configuration.recipient", "requirements"] });
      });

      test("detailsSubmitted is false while any requirement is still awaiting the merchant", async () => {
        accountsRetrieve.mockResolvedValue({
          configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: "pending" } } } } },
          requirements: { entries: [{ awaiting_action_from: "user" }, { awaiting_action_from: "stripe" }] },
        });
        const provider = new StripeProvider(config);

        const result = await provider.getConnectAccountStatus("acct_1");

        expect(result.chargesEnabled).toBe(false);
        expect(result.detailsSubmitted).toBe(false);
      });

      test("detailsSubmitted is true once every remaining requirement is Stripe's, not the merchant's", async () => {
        accountsRetrieve.mockResolvedValue({
          configuration: { recipient: { capabilities: {} } },
          requirements: { entries: [{ awaiting_action_from: "stripe" }] },
        });
        const provider = new StripeProvider(config);

        const result = await provider.getConnectAccountStatus("acct_1");

        expect(result.detailsSubmitted).toBe(true);
      });
    });
  });
});
