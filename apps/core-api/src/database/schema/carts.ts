import { integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { products } from "./products";
import { tenants } from "./tenants";

/**
 * Tenant-owned, one active cart per customer (uniqueIndex below) — no
 * guest carts yet. The storefront OTP login UI isn't built (see CLAUDE.md
 * build order), but the customer-auth backend and CustomerJwtAuthGuard
 * already exist, so tying the cart to an authenticated customer has a real
 * caller today; a guest/session-cookie cart would not. No abandoned-cart
 * history either — updating this same row on every add/remove is enough
 * for "what's in my cart right now", which is all anything reads today.
 */
export const carts = pgTable(
  "carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("carts_customer_unique").on(table.customerId)],
);

/**
 * One row per distinct product in a cart (uniqueIndex below) — adding the
 * same product again increments quantity on the existing row instead of
 * inserting a duplicate. tenantId duplicated for RLS — see inventory.ts.
 */
export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("cart_items_cart_product_unique").on(table.cartId, table.productId)],
);
