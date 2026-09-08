import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Internal Folkshops staff — global, no tenant, deliberately separate from
 * users/memberships (merchant-side, tenant-scoped). No self-service
 * registration (see PlatformAdminModule) and no RLS: same governance as
 * tenants/users — nothing here is tenant-owned data to isolate.
 */
export const platformAdmins = pgTable("platform_admins", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
