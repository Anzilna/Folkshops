import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended"]);

/**
 * The tenant registry itself — not tenant-owned, so no RLS.
 *
 * `suspended` is set only by a platform admin (PlatformAdminTenantsService)
 * and is enforced at the front door: StoreAvailableGuard refuses every
 * request that resolves to a suspended store, and staff login/refresh and
 * the MCP/AI paths re-check it independently. `suspensionReason` is an
 * INTERNAL note for the next platform admin — never shown to the merchant.
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: tenantStatusEnum("status").notNull().default("active"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
