import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Tenant-owned, same RLS pattern as products (see
 * migrations/<N>_enable-rls-categories.sql). Deliberately flat — no
 * parentId/self-reference for nested subcategories yet, since nothing
 * (no UI, no query) needs a category tree today. Add it when something
 * actually calls for it rather than speculatively.
 *
 * A product belongs to at most one category (see products.categoryId) —
 * not a many-to-many join table. Real storefronts often want a product in
 * several collections at once, but nothing in this codebase needs that
 * yet either; a join table is a bigger schema/migration to unwind than a
 * nullable FK is to extend, so start with the simpler shape.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("categories_tenant_slug_unique").on(table.tenantId, table.slug)],
);
