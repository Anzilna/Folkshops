import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The plan catalog — not tenant-owned, no RLS (same posture as `tenants`
 * itself). Seeded by migration 0027 with PLACEHOLDER numbers the user
 * asked to add now and update later — see docs/decisions/0012's table.
 * `maxProducts: null` means unlimited. `aiAccess` is stored but not
 * enforced anywhere yet (see the ADR's "tracked but not enforced" section)
 * — apps/ai-service has no concept of plans today.
 */
export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("aed"),
  maxProducts: integer("max_products"),
  aiAccess: boolean("ai_access").notNull().default(false),
  // Stripe Price objects are immutable once created — a price change
  // always means a NEW Stripe Price id, never an edit in place. Nullable
  // because the free plan (priceCents = 0) never talks to Stripe at all.
  stripePriceId: text("stripe_price_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
