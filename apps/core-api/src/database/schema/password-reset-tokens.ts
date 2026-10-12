import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Staff password-reset tokens (merchant-admin's /forgot-password). Only the
 * SHA-256 of the token is stored — same as refresh_tokens, and not RLS'd
 * for the same reason (see refresh-tokens.ts): rows are only ever looked up
 * by exact tokenHash, a 256-bit secret, and users aren't tenant-owned.
 *
 * Rows are created by apps/workers (handlers/password-reset-requested.ts),
 * not core-api — the raw token then exists only inside the email itself,
 * never in outbox_events.payload. See docs/decisions/0013.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("password_reset_tokens_user_idx").on(table.userId)],
);
