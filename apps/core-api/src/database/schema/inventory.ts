import { boolean, integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { products } from "./products";
import { tenants } from "./tenants";

/**
 * Tenant-owned, one row per product (uniqueIndex below) — no variants or
 * multi-location stock yet, so "stock for this product" is a single
 * integer today. tenantId is duplicated here rather than derived by
 * joining through products: RLS policies filter each table on its own
 * tenant_id column directly (see withTenantContext), so every
 * tenant-owned table needs the column even when it's also reachable via
 * a FK join, same as cart_items/order_items below.
 *
 * quantity is a plain counter, adjusted directly by InventoryService — NOT
 * a reservation/hold system. Concurrent checkouts can still both read the
 * same quantity and both succeed, oversell included. That's the explicit
 * Phase 2 "inventory reservation" item in CLAUDE.md's build order; this
 * table exists now so Phase 2 has a place to add locking, not to solve
 * overselling today.
 */
export const inventory = pgTable(
  "inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull().default(0),
    // isActive=false means "tracked but not counted as sellable stock"
    // (distinct from quantity=0, which is just "none in stock right now")
    // — a staff-side pause switch. deletedAt is soft-delete, same pattern
    // as products/categories/customers — see InventoryService for how a
    // soft-deleted row can be revived by creating/updating it again rather
    // than needing a separate restore endpoint.
    isActive: boolean("is_active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("inventory_product_unique").on(table.productId)],
);
