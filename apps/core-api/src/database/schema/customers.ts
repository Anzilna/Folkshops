import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Storefront shoppers — tenant-owned, unlike users (global-with-memberships,
 * for staff spanning many stores). The same phone number is a separate
 * customer row at two different tenants; there is no cross-tenant customer
 * identity. Created on first successful OTP verification (see
 * customer-auth.service.ts) — no separate signup step, no password.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    phone: text("phone").notNull(),
    name: text("name"),
    // See products.ts's isActive/deletedAt comment — same pattern. For a
    // customer, isActive=false is a staff-side "block this account"
    // switch (they can still be looked up/edited, just not meant to
    // transact); it has no effect on OTP login today since nothing checks
    // it yet — see CLAUDE.md's Deliberately Deferred list.
    isActive: boolean("is_active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("customers_tenant_phone_unique").on(table.tenantId, table.phone)],
);
