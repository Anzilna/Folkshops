import { pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Deliberately NOT RLS-protected — same reasoning as refresh_tokens: this
 * table exists to answer exactly the question RLS on `memberships` makes
 * impossible to ask safely (which tenant(s) is this user a member of,
 * before any tenant is known — memberships' own RLS policy requires
 * app.tenant_id already set, which is the whole chicken-and-egg problem).
 * It stores nothing sensitive — no role, no permissions, just "this user
 * has an account at this tenant" — a far smaller exposure than bypassing
 * RLS on memberships itself would be (which the app role must never do,
 * see CLAUDE.md bug #1).
 *
 * Populated in the same transaction as every `memberships` insert — today
 * that's only AuthService.register() (staff invitations, the only other
 * place a membership could be created, are still deliberately deferred).
 * Read by AuthService.identify() (POST /auth/identify), which lets
 * merchant-admin's login form resolve which store an email belongs to
 * instead of asking the person to type a slug by hand — see that
 * endpoint's own rate-limiting for why "which stores does this email
 * belong to" being answerable at all needs to stay throttled.
 */
export const membershipLookup = pgTable(
  "membership_lookup",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("membership_lookup_user_tenant_unique").on(table.userId, table.tenantId)],
);
