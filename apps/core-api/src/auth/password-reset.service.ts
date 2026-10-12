import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { membershipLookup, outboxEvents, passwordResetTokens, refreshTokens, users } from "../database/schema";

const PASSWORD_HASH_ROUNDS = 10;
/** One email per address per minute, on top of the route's per-IP throttle — stops someone flooding a known staff inbox from many IPs. */
const REQUEST_COOLDOWN = sql`now() - interval '1 minute'`;

/**
 * Staff (merchant-admin) password reset. Deliberately split in two across
 * processes: requestReset() only records *that* a reset was asked for (an
 * outbox row); apps/workers generates the actual token and emails it. So
 * the raw token never exists in core-api, in outbox_events, or in any log
 * — only in the email and, hashed, in password_reset_tokens.
 */
@Injectable()
export class PasswordResetService {
  constructor(private readonly dbRouter: DbRouter) {}

  /**
   * Always resolves the same way whether or not the email exists — the
   * caller returns an identical response either way, so this endpoint
   * reveals nothing /auth/identify doesn't already.
   */
  async requestReset(email: string): Promise<void> {
    const [user] = await this.dbRouter.read("strong", (db) => db.select().from(users).where(eq(users.email, email)).limit(1));
    if (!user) return;

    // outbox_events.tenant_id is NOT NULL, but a user isn't tenant-owned
    // — any one of their stores works as the row's tenant; the worker
    // never uses it for anything but withTenantContext bookkeeping.
    const [lookup] = await this.dbRouter.read("strong", (db) =>
      db.select().from(membershipLookup).where(eq(membershipLookup.userId, user.id)).limit(1),
    );
    if (!lookup) return;

    await this.dbRouter.write((db) =>
      db.transaction(async (tx) => {
        const [recent] = await tx
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.eventType, "staff.password_reset_requested"),
              eq(outboxEvents.aggregateId, user.id),
              gt(outboxEvents.createdAt, REQUEST_COOLDOWN),
            ),
          )
          .limit(1);
        if (recent) return;
        await tx.insert(outboxEvents).values({
          tenantId: lookup.tenantId,
          eventType: "staff.password_reset_requested",
          aggregateType: "user",
          aggregateId: user.id,
          payload: { userId: user.id },
        });
      }),
    );
  }

  /**
   * Single transaction: claim the token (the conditional UPDATE is what
   * makes it single-use even under two concurrent submits), set the new
   * password, burn any other outstanding reset links, and revoke every
   * staff session — a reset is usually "someone else may have my
   * password", so existing logins must not survive it.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_HASH_ROUNDS);

    const ok = await this.dbRouter.write((db) =>
      db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokens.tokenHash, tokenHash),
              isNull(passwordResetTokens.usedAt),
              gt(passwordResetTokens.expiresAt, sql`now()`),
            ),
          )
          .returning({ userId: passwordResetTokens.userId });
        if (!claimed) return false;

        await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, claimed.userId));
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(and(eq(passwordResetTokens.userId, claimed.userId), isNull(passwordResetTokens.usedAt)));
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.subjectType, "staff"), eq(refreshTokens.subjectId, claimed.userId), isNull(refreshTokens.revokedAt)));
        return true;
      }),
    );

    // One message for unknown/expired/used — which of the three it was
    // isn't the visitor's business, and the fix is the same: ask again.
    if (!ok) throw new BadRequestException("This reset link is invalid or has expired.");
  }
}
