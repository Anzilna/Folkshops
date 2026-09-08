import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const authSubjectTypeEnum = pgEnum("auth_subject_type", ["staff", "platform_admin", "customer"]);

/**
 * One row per issued refresh token, across all three auth surfaces (staff/
 * merchant-admin, platform_admin, customer/storefront) — subjectType +
 * subjectId says who it belongs to instead of three near-identical tables.
 *
 * tenantId is the tenant a session is scoped to (staff logged into store X,
 * or a customer of store X) — needed on refresh to reissue an access token
 * with the right tenant claim, since a staff user can belong to many
 * tenants via memberships. Null for platform_admin, which is global.
 *
 * Deliberately NOT tenant-owned data in the RLS sense: nothing ever queries
 * this table filtered by a client-supplied tenant scope — core-api's own
 * auth code looks rows up only by exact tokenHash (a 256-bit secret). The
 * security boundary here is "you possess the token", not "your tenant_id
 * matches a row filter", so RLS wouldn't add protection the way it does
 * for products/memberships.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectType: authSubjectTypeEnum("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    tenantId: uuid("tenant_id"),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("refresh_tokens_subject_idx").on(table.subjectType, table.subjectId)],
);
