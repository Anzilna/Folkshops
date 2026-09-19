import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import {
  ConnectAccountStatus,
  CreateAccountLinkResult,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  CreateConnectAccountResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
} from "../payment-provider.interface";

/**
 * Config read lazily inside a private client() method, never the
 * constructor (CLAUDE.md bug #15) — Nest builds every provider at boot
 * regardless of whether a request ever reaches it, so a missing
 * STRIPE_SECRET_KEY must fail only the one request that needs it, not the
 * entire app.
 */
@Injectable()
export class StripeProvider implements PaymentProvider {
  private readonly logger = new Logger(StripeProvider.name);

  constructor(private readonly config: ConfigService) {}

  private client(): { instance: Stripe; webhookSecret: string | null } | null {
    const secretKey = this.config.get<string>("STRIPE_SECRET_KEY");
    if (!secretKey) return null;
    const webhookSecret = this.config.get<string>("STRIPE_WEBHOOK_SECRET") ?? null;
    return { instance: new Stripe(secretKey), webhookSecret };
  }

  private require() {
    const client = this.client();
    if (!client) {
      this.logger.error("Payment attempted but STRIPE_SECRET_KEY isn't set");
      throw new InternalServerErrorException("Payments aren't configured in this environment");
    }
    return client;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult> {
    const { instance } = this.require();
    const session = await instance.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: input.receipt,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: input.amountCents,
              product_data: { name: `Order ${input.receipt}` },
            },
          },
        ],
        // Destination charge — the platform account collects the payment
        // and Stripe automatically transfers it to the connected account,
        // same "platform collects, routes to the tenant" shape the old
        // Route `transfers` array had. No application_fee_amount — this
        // codebase doesn't take a platform cut (see ADR 0006 addendum).
        payment_intent_data: {
          transfer_data: { destination: input.connectedAccountId },
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!session.url) throw new InternalServerErrorException("Stripe Checkout Session had no url");
    return { providerSessionId: session.id, url: session.url };
  }

  async fetchCheckoutSession(providerSessionId: string): Promise<Stripe.Checkout.Session> {
    const { instance } = this.require();
    return instance.checkout.sessions.retrieve(providerSessionId);
  }

  constructWebhookEvent(input: { rawBody: string; signature: string }): Stripe.Event {
    const { instance, webhookSecret } = this.require();
    if (!webhookSecret) {
      this.logger.error("Webhook received but STRIPE_WEBHOOK_SECRET isn't set");
      throw new InternalServerErrorException("Webhook verification isn't configured in this environment");
    }
    // Verifies AND parses in one call — throws StripeSignatureVerificationError
    // on a bad signature or malformed payload, which StripeSignatureGuard
    // catches and turns into a 401. Must run against the exact raw bytes
    // Stripe signed, never req.body's re-serialized JSON (same discipline
    // as the old RazorpaySignatureGuard — see main.ts's rawBody: true).
    return instance.webhooks.constructEvent(input.rawBody, input.signature, webhookSecret);
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const { instance } = this.require();
    const refund = await instance.refunds.create({
      payment_intent: input.providerPaymentIntentId,
      ...(input.amountCents !== undefined ? { amount: input.amountCents } : {}),
    });
    return { providerRefundId: refund.id, status: refund.status ?? "unknown" };
  }

  /**
   * v2 Core Accounts (`stripe.v2.core.accounts`), not v1's `accounts.create({type: "express"})`
   * — this platform's Stripe account doesn't have v1 account creation
   * enabled (a real `Access Denied`-shaped error surfaced this live; v1 is
   * being phased out for new Connect integrations, confirmed against
   * current docs and the installed SDK's V2/Core/Accounts.d.ts before
   * rewriting this). The **recipient** configuration, not merchant — our
   * checkout uses a destination charge with no `on_behalf_of` set
   * (StripeProvider.createCheckoutSession()), which per Stripe's own
   * config docs (Configuration.Recipient's doc comment in Accounts.d.ts)
   * means this connected account is never the merchant of record; it only
   * needs to *receive* the transferred funds, which is exactly what the
   * `recipient` configuration's `stripe_balance` capabilities are for.
   * `dashboard: "express"` is the v2 equivalent of v1's Express account
   * type — Stripe-hosted dashboard/KYC, same as before.
   */
  async createConnectAccount(contactEmail: string): Promise<CreateConnectAccountResult> {
    const { instance } = this.require();
    const account = await instance.v2.core.accounts.create({
      dashboard: "express",
      contact_email: contactEmail,
      // Required the moment configuration.recipient is set (confirmed
      // live: 400 "identity.country is required before setting
      // configuration.recipient" otherwise). Hardcoded to "AE" — not a
      // Folkshops business-identity decision, a hard Stripe platform-country
      // restriction: this Stripe platform account is itself UAE-registered,
      // and Stripe only lets a UAE-based platform create UAE-based
      // connected accounts under Connect's self-serve Express model
      // (confirmed live: "Connected accounts in IN cannot be created by
      // platforms in AE" when this was "IN"; also documented at
      // docs.stripe.com/connect/express-accounts under "Countries that
      // don't support self-serve"). If Folkshops' platform Stripe account
      // is ever swapped for an India-registered one, this needs to become
      // "IN" again.
      identity: { country: "AE" },
      configuration: {
        recipient: {
          capabilities: {
            // Receives this checkout's destination-charge transfers.
            // `payouts` isn't a requestable capability on account
            // creation for the recipient configuration (confirmed against
            // the SDK's own create-params type, which only exposes
            // `stripe_transfers` here) — it's read back in
            // getConnectAccountStatus() once available, not requested
            // up front.
            stripe_balance: { stripe_transfers: { requested: true } },
          },
        },
      },
      // The platform, not Stripe, is liable for fees/losses on a
      // recipient-only account — confirmed live against a real Stripe
      // account (400: "Losses/Fees collector can only be \"application\"
      // for the set of configurations this account has"). Makes sense in
      // hindsight: this account is never the merchant of record (no
      // on_behalf_of on the destination charge), so Stripe won't let it
      // carry Stripe-collected fees/losses the way a merchant-configured
      // Express account would.
      defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
    });
    return { accountId: account.id };
  }

  /** The actual hosted onboarding redirect — v2's Account Links
   * (`stripe.v2.core.accountLinks.create`, confirmed against
   * AccountLinks.d.ts), `use_case.type: "account_onboarding"` targeting
   * the `recipient` configuration created above. A fresh link must be
   * minted per redirect; Stripe's own links expire after a few minutes
   * and are single-use. */
  async createAccountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<CreateAccountLinkResult> {
    const { instance } = this.require();
    const link = await instance.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: { configurations: ["recipient"], refresh_url: refreshUrl, return_url: returnUrl },
      },
    });
    return { url: link.url };
  }

  /**
   * v2 Accounts return `null` for most nested fields unless explicitly
   * requested via `include` (confirmed in Accounts.d.ts's own doc
   * comment) — `configuration.recipient`/`requirements` must be listed or
   * they come back empty even though they exist.
   *
   * v2 has no single `charges_enabled`/`details_submitted` boolean the
   * way v1 did — capabilities are per-feature (`status: "active" |
   * "pending" | "restricted" | "unsupported"`), and "has the merchant
   * finished what's needed from them" is derived from `requirements`,
   * not a flag. `chargesEnabled` here means "can this account actually
   * receive our destination-charge transfers" (`stripe_transfers.status`)
   * — the real equivalent of v1's gate for this codebase's purposes.
   * `detailsSubmitted` is true once nothing is `awaiting_action_from:
   * "user"` — i.e. the merchant has done their part, whatever remains is
   * Stripe's review, mirroring what v1's `details_submitted` meant.
   */
  async getConnectAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
    const { instance } = this.require();
    const account = await instance.v2.core.accounts.retrieve(accountId, {
      include: ["configuration.recipient", "requirements"],
    });
    const stripeBalance = account.configuration?.recipient?.capabilities?.stripe_balance;
    const entries = account.requirements?.entries ?? [];
    return {
      chargesEnabled: stripeBalance?.stripe_transfers?.status === "active",
      payoutsEnabled: stripeBalance?.payouts?.status === "active",
      detailsSubmitted: !entries.some((entry) => entry.awaiting_action_from === "user"),
    };
  }
}
