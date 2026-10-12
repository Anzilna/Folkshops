import type Stripe from "stripe";

/**
 * Same swap-seam pattern as PAYMENT_GATEWAY (payments/payment-provider.interface.ts)
 * — one Symbol token, one interface, bound via `useClass` in
 * SubscriptionsCoreModule. Deliberately a SEPARATE interface from
 * PaymentProvider, not an extension of it: PaymentProvider is shaped
 * entirely around Stripe Connect (a connectedAccountId money is routed
 * TO). Subscription billing charges the platform's own merchants
 * directly — no connected account is ever involved. See
 * docs/decisions/0012 for why these are kept apart.
 */
export const BILLING_GATEWAY = Symbol("BILLING_GATEWAY");

export interface CreateBillingCustomerResult {
  customerId: string;
}

export interface CreateBillingCheckoutInput {
  stripeCustomerId: string;
  /** Stripe Price id (plans.stripePriceId) — immutable once created, see plans.ts's own comment. */
  stripePriceId: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Our own plans.id, round-tripped through Stripe as Checkout Session
   * metadata — the webhook's checkout.session.completed handler reads it
   * back (session.metadata.planId) to know which plan to set on the
   * subscriptions row. Required for changePlan()'s free->paid path, where
   * (unlike registration) nothing already wrote the new planId to our DB
   * before Checkout started.
   */
  planId: string;
}

export interface CreateBillingCheckoutResult {
  providerSessionId: string;
  url: string;
}

export interface BillingProvider {
  createCustomer(email: string, tenantId: string): Promise<CreateBillingCustomerResult>;
  createCheckoutSession(input: CreateBillingCheckoutInput): Promise<CreateBillingCheckoutResult>;
  createPortalSession(stripeCustomerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Proration handled by Stripe itself (default behavior) — upgrading/downgrading an existing subscription's price. */
  updateSubscriptionPrice(stripeSubscriptionId: string, newStripePriceId: string): Promise<void>;
  cancelSubscription(stripeSubscriptionId: string): Promise<void>;
  /** Verifies AND parses in one step — same posture as PaymentProvider.constructWebhookEvent(). */
  constructWebhookEvent(input: { rawBody: string; signature: string }): Stripe.Event;
}
