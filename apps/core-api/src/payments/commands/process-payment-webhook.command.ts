import type Stripe from "stripe";

/** Delegates to PaymentsService.handleWebhookEvent() — signature
 * verification (StripeSignatureGuard) has already run before this is
 * dispatched; webhook idempotency (unique constraint on
 * (tenantId, providerEventId)), tenant resolution via the non-RLS
 * payment_order_lookup table, and the outbox write all stay exactly as
 * they are, entirely inside PaymentsService. */
export class ProcessPaymentWebhookCommand {
  constructor(public readonly event: Stripe.Event) {}
}
