import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const productStatusEnum = pgEnum("product_status", ["draft", "active", "archived"]);

/**
 * Tenant-owned — same RLS pattern as memberships (see
 * migrations/0004_enable-rls-products.sql).
 *
 * priceCents is an integer (smallest currency unit — paise for INR), not a
 * decimal/float column: floats lose precision on money, and JS numbers
 * round-trip integers exactly but not arbitrary decimals, so ₹1,499.00 is
 * stored as 149900, not 1499.00.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull(),
    status: productStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("products_tenant_slug_unique").on(table.tenantId, table.slug)],
);
