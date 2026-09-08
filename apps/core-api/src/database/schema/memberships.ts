import { pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

export const membershipRoleEnum = pgEnum("membership_role", ["owner", "staff"]);

/**
 * A user's role within one tenant. This IS tenant-owned data — the first
 * table Row-Level Security is applied to (see migrations/0001-enable-rls).
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("memberships_tenant_user_unique").on(table.tenantId, table.userId)],
);
