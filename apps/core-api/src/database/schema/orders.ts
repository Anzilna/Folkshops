import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { products } from "./products";
import { tenants } from "./tenants";

/**
 * "pending" is the only real state today — checkout creates an order and
 * nothing since moves it anywhere else. "cancelled" exists so a customer
 * can back out of an order they just placed. Payment/fulfillment states
 * (paid, shipped, delivered, refunded, ...) are the Phase 2 "order state
 * machine" item in CLAUDE.md's build order and deliberately don't exist
 * yet — extend this enum then, don't grow it speculatively now.
 */
export const orderStatusEnum = pgEnum("order_status", ["pending", "cancelled"]);

/**
 * Tenant-owned. subtotalCents is the sum of its order_items at checkout
 * time, stored rather than computed on read — same reasoning as the price
 * snapshot on order_items below: what a customer paid shouldn't move if
 * product prices change later. No payment fields (Razorpay order/payment
 * IDs, etc.) — that integration is Phase 2, not built yet.
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
