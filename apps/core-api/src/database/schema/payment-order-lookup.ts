import { pgTable, timestamp, uniqueIndex, uuid, text } from "drizzle-orm/pg-core";
import { orders } from "./orders";
import { payments } from "./payments";
import { tenants } from "./tenants";

/**
 * Deliberately NOT RLS-protected — same reasoning as membership_lookup,
 * same chicken-and-egg problem, one level removed: a Stripe webhook
 * arrives knowing only a providerOrderId (Stripe's own Checkout Session
 * id), and every other table that could answer "which tenant does this
 * belong to" requires app.tenant_id already set — which is exactly what
 * the webhook doesn't have yet, since it carries no session/cookie/header
 * we can trust as a tenant identifier (see StripeSignatureGuard — the
 * webhook is authenticated by signature, not by any tenant-scoped
 * credential).
 *
 * Stores nothing sensitive — no amount, no status, no provider secret,
 * just "this Stripe Checkout Session belongs to this tenant/order/
 * payment" — the same "far smaller exposure than bypassing RLS on the
 * real tables would be" argument membership_lookup's own comment makes.
 *
 * Populated in the same transaction as the `payments` insert that first
 * learns the real providerOrderId (PaymentsService.initiatePayment()).
 * Read by PaymentsService.handleWebhookEvent() before any tenant context
 * exists — the first thing that happens after signature verification.
 */
export const paymentOrderLookup = pgTable(
  "payment_order_lookup",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerOrderId: text("provider_order_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("payment_order_lookup_provider_order_id_unique").on(table.providerOrderId)],
);
