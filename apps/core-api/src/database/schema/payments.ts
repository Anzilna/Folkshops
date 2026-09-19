import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { orders } from "./orders";
import { tenants } from "./tenants";

/**
 * Provider-agnostic lifecycle terms (no translation layer needed since
 * both gateways this codebase has used map onto the same shape) —
 * "created" the moment a provider checkout session exists, "captured"
 * once the provider confirms payment, "failed" if the attempt doesn't
 * complete, "refunded"/"partially_refunded" only reachable from
 * "captured" (see PaymentsService for the exact transition rules; this
 * enum doesn't enforce them itself, application code does). "authorized"
 * is unused by StripeProvider (Stripe Checkout captures directly) but
 * kept in the enum rather than migrated away — a future provider or
 * manual-capture flow may need it.
 */
export const paymentStatusEnum = pgEnum("payment_status", [
  "created",
  "authorized",
  "captured",
  "failed",
  "refunded",
  "partially_refunded",
]);

/**
 * Tenant-owned, RLS-enabled (database/migrations/0016_enable-rls-payments.sql).
 * One row per payment *attempt* against an order — a failed attempt
 * followed by a retry is a second row against the same orderId, not an
 * update to the first, so the full attempt history survives.
 *
 * `provider` is the seam a second gateway slots into later — every other
 * column here is provider-agnostic; only StripeProvider knows what
 * providerOrderId/providerPaymentId actually mean (a Stripe Checkout
 * Session id and PaymentIntent id, respectively).
 *
 * amountCents is a snapshot of what the order was for at payment-attempt
 * time, same reasoning as order_items' own price snapshot — never trust
 * a later read of orders.subtotalCents to reconstruct what was charged.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    provider: text("provider").notNull().default("stripe"),
    // Nullable — populated once the provider checkout-session-create call
    // succeeds (providerOrderId, a Stripe Checkout Session id) / once a
    // payment is actually confirmed (providerPaymentId, a Stripe
    // PaymentIntent id). A row can legitimately exist with neither yet
    // set for a few milliseconds mid-request.
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    // Client-supplied (an Idempotency-Key header), not server-generated —
    // this is what makes a retried POST /pay a no-op rather than a second
    // Stripe Checkout Session. See PaymentsService.initiatePayment().
    idempotencyKey: text("idempotency_key").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("AED"),
    status: paymentStatusEnum("status").notNull().default("created"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("payments_tenant_idempotency_key_unique").on(table.tenantId, table.idempotencyKey),
    uniqueIndex("payments_provider_payment_id_unique").on(table.providerPaymentId),
  ],
);
