import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Short-lived OTP login challenges — tenant-owned like customers (a phone
 * requesting a code for store A is unrelated to the same phone requesting
 * one for store B). codeHash, not the raw code — same reasoning as
 * refresh_tokens: never persist the actual secret. Rows are never deleted,
 * only marked consumed, so a burst of attempts against one phone stays
 * visible/auditable rather than disappearing.
 */
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("otp_codes_tenant_phone_idx").on(table.tenantId, table.phone)],
);
