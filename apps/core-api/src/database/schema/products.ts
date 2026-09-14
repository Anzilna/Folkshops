import { boolean, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { categories } from "./categories";
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
    // Nullable — a product doesn't have to be categorized to exist. See
    // categories.ts for why this is a single FK, not a join table.
    categoryId: uuid("category_id").references(() => categories.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Opaque to the backend — plain text for products created before this
    // column existed (seed data, CSV imports, which never go through the
    // editor) or Editor.js's JSON OutputData (stringified) for anything
    // saved through merchant-admin's product form. Never validated or
    // parsed server-side; every reader (storefront, merchant-admin) must
    // fall back to rendering it as plain text if it isn't valid Editor.js
    // JSON — see storefront's lib/editorjs-render.tsx.
    description: text("description"),
    // The full, browser-loadable URL returned by S3Service.upload() —
    // MinIO's published host port in dev, a real S3/CDN URL in prod.
    // Stored absolute (not a bucket key) so a frontend never needs to know
    // which environment's base URL to prefix. Nullable: most products
    // won't have one until someone uploads one via the product form.
    imageUrl: text("image_url"),
    priceCents: integer("price_cents").notNull(),
    status: productStatusEnum("status").notNull().default("draft"),
    // Separate from `status` above: status is the storefront publish
    // lifecycle (draft/active/archived — what shoppers can see), isActive
    // is a staff-only on/off switch independent of that (e.g. temporarily
    // pulling a product from action without changing its publish state).
    // deletedAt is soft-delete — DELETE sets this instead of removing the
    // row, so every read path must exclude rows where it's set (see
    // products.service.ts's buildFilters).
    isActive: boolean("is_active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("products_tenant_slug_unique").on(table.tenantId, table.slug)],
);
