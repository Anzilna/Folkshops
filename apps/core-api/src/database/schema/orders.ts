import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { products } from "./products";
import { tenants } from "./tenants";

/**
 * Extended for the payment gateway integration — this is the "extend this
 * enum then" the original comment pointed at. State machine (enforced in
 * application code, PaymentsService, not by the enum itself):
 *   pending -> awaiting_payment (a payments row gets a real providerOrderId)
 *   awaiting_payment -> paid (webhook/client-verify confirms capture)
 *   awaiting_payment -> payment_failed (provider reports failure; a retry
 *     creates a NEW payments row against the same order, reusing/rotating
 *     the idempotency key rather than mutating the failed one)
 *   pending -> cancelled (customer backs out before any payment attempt —
 *     NOT reachable once awaiting_payment, cancelling mid-payment-flight
 *     isn't supported)
 *   paid -> refunded / paid -> partially_refunded (staff-initiated, see
 *     PaymentsService.refundPayment())
 * Fulfillment states (shipped, delivered, ...) remain a later Phase 2 item
 * — not added here, this enum only covers payment.
 */
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "awaiting_payment",
  "paid",
  "payment_failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);

/**
 * Tenant-owned. subtotalCents is the sum of its order_items at checkout
 * time, stored rather than computed on read — same reasoning as the price
 * snapshot on order_items below: what a customer paid shouldn't move if
 * product prices change later. No payment fields live directly on this
 * table (no Stripe session/payment IDs) — those live on `payments`
 * (payments.ts), one-to-many against an order (each attempt is its own
 * row); `orders.status` is the single source of truth for where the
 * order currently stands, updated by PaymentsService as payments resolve.
 */
export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  status: orderStatusEnum("status").notNull().default("pending"),
  subtotalCents: integer("subtotal_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * productName/priceCents are a snapshot taken at checkout, not a live join
 * to products — an order placed today must keep showing what was actually
 * charged even if the product is later renamed, repriced, or deleted.
 * tenantId duplicated for RLS — see inventory.ts.
 */
export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  productName: text("product_name").notNull(),
  priceCents: integer("price_cents").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
