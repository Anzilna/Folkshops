import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { plans } from "./plans";
import { tenants } from "./tenants";

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "incomplete",
  "active",
  "past_due",
  "canceled",
]);

/**
 * Tenant-owned, RLS-enabled, at most one row per tenant (uniqueIndex below)
 * — same shape as `payment_accounts`. Created at registration time: the
 * free plan goes straight to status "active" with no Stripe call; a paid
 * plan starts "incomplete" until the Checkout Session's webhook confirms
 * payment. See docs/decisions/0012.
 *
 * Limit checks (ProductsService.create()) read this row's `planId` ->
 * plans.maxProducts regardless of `status` — a `past_due`/`incomplete`
 * tenant is NOT downgraded to the free plan's limits in this pass, a
 * documented gap (see the ADR's Failure modes).
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatusEnum("status").notNull().default("incomplete"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("subscriptions_tenant_unique").on(table.tenantId)],
);

/**
 * Deliberately non-RLS — same reasoning as `payment_order_lookup`/
 * `membership_lookup`: the Stripe webhook must resolve which tenant a
 * `customer.subscription.*` event belongs to (Stripe sends a
 * stripeCustomerId, never our tenantId) before any tenant context can be
 * set. Populated alongside every `subscriptions` insert that gets a real
 * Stripe customer (i.e. every paid-plan signup).
 */
export const subscriptionCustomerLookup = pgTable("subscription_customer_lookup", {
  stripeCustomerId: text("stripe_customer_id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
});
