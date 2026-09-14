import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { products } from "./products";
import { tenants } from "./tenants";

/**
 * A product's gallery — additional photos beyond `products.imageUrl`
 * (which stays the single "cover" image used everywhere a product is
 * shown as one tile: list thumbnails, storefront catalog grid, CSV
 * export). Tenant-owned, same RLS pattern as products — see
 * migrations/<N>_enable-rls-product-images.sql.
 *
 * Managed as a whole array, not individual rows with their own
 * create/delete endpoints: ProductsService.update()/create() replace a
 * product's entire gallery in one write (delete all, reinsert in the
 * given order) whenever `images` is present in the request body — same
 * "the form saves everything at once" shape as every other product
 * field, and far simpler than incremental per-image CRUD for what's
 * fundamentally one ordered list a merchant edits as a unit.
 */
export const productImages = pgTable("product_images", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  url: text("url").notNull(),
  // Display order — not a unique/sequential guarantee, just "sort by this".
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
