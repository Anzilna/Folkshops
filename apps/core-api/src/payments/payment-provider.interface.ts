import type Stripe from "stripe";

/**
 * Same swap-seam pattern as OTP_PROVIDER (storefront/otp-provider.ts) —
 * one Symbol token, one interface, bound via `useClass` in a module.
 * `StripeProvider` is the only implementation. A second gateway would
 * implement this same interface; nothing in PaymentsService,
 * PaymentAccountsService, or the checkout/webhook controllers would need
 * to change.
 */
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");

export interface CreateCheckoutSessionInput {
  amountCents: number;
  /** ISO currency code, lowercase (Stripe's own convention) — e.g. "aed". */
  currency: string;
  /** Our own payment id — carried as client_reference_id so a Stripe
   * session can always be traced back to our row. */
  receipt: string;
  /** Stripe Connect account (destination charge target) money is routed
   * to at capture time. */
  connectedAccountId: string;
  successUrl: string;
  cancelUrl: string;
  /** Passed to Stripe as its own request Idempotency-Key, on top of our
   * DB-level unique constraint — belt and suspenders, not a replacement
   * for it (see PaymentsService.initiatePayment()'s own comment). */
  idempotencyKey: string;
}

export interface CreateCheckoutSessionResult {
  providerSessionId: string;
  /** Redirect the customer's browser here — Stripe's own hosted Checkout
   * page, not anything Folkshops renders. */
  url: string;
}

export interface RefundInput {
  providerPaymentIntentId: string;
  /** Omit for a full refund of whatever remains refundable. */
  amountCents?: number;
}

export interface RefundResult {
  providerRefundId: string;
  status: string;
}

/** Connect account creation — Step 1 of "Connect Stripe". Deliberately
 * takes nothing but the fact that the account should exist: Stripe's own
 * hosted Account Link onboarding collects every KYC field itself (see
 * createAccountLink()'s comment), so unlike the old Razorpay Route flow
 * this codebase collects zero business details up front. */
export interface CreateConnectAccountResult {
  accountId: string;
}

/** Step 2 — the actual hosted onboarding redirect (the literal "Connect
 * Stripe" button target). refreshUrl/returnUrl are both required by
 * Stripe: refreshUrl is where the merchant lands if the link expired or
 * was already used (call this again to mint a fresh one); returnUrl is
 * where they land after exiting the flow, successfully or not — neither
 * URL carries any state, the account must be re-fetched to know what
 * actually happened (see ConnectAccountStatus). */
export interface CreateAccountLinkResult {
  url: string;
}

export interface ConnectAccountStatus {
  /** The actual payment-acceptance gate — see PaymentAccountsService's
   * isPaymentsEnabled(). Stripe's `status`-shaped field doesn't exist on
   * an Account the way Razorpay had one; charges_enabled/payouts_enabled/
   * details_submitted together are what Stripe itself recommends
   * checking instead. */
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export interface PaymentProvider {
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult>;
  /** Re-fetches a Checkout Session from Stripe directly — never trusts a
   * client-reported "success" alone (mirrors the old Razorpay posture,
   * see PaymentsService's own comment). */
  fetchCheckoutSession(providerSessionId: string): Promise<Stripe.Checkout.Session>;
  /** Verifies AND parses in one step (constructEvent does both) — a
   * signature-valid payload that failed to parse isn't a real event
   * either, so there's no meaningful "verified but unparsed" state to
   * return separately. Throws on an invalid signature or malformed body;
   * the caller (StripeSignatureGuard) converts that into a 401. */
  constructWebhookEvent(input: { rawBody: string; signature: string }): Stripe.Event;
  refund(input: RefundInput): Promise<RefundResult>;
  /** contactEmail — confirmed live against a real Stripe account: v2's
   * `recipient` configuration 400s at creation without one. The logged-in
   * staff member's own email (already known, already verified via their
   * session) — not a new field Folkshops asks the merchant to fill in. */
  createConnectAccount(contactEmail: string): Promise<CreateConnectAccountResult>;
  createAccountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<CreateAccountLinkResult>;
  getConnectAccountStatus(accountId: string): Promise<ConnectAccountStatus>;
}
