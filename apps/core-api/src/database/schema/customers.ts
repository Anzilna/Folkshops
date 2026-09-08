import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("customers_tenant_phone_unique").on(table.tenantId, table.phone)],
);
