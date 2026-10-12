import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db";
import { enqueueEmail } from "../email-queue";
import { env } from "../env";

const RESET_TOKEN_TTL_MINUTES = 30;

/**
 * staff.password_reset_requested -> mint a single-use token and email it.
 * The token is created HERE rather than in core-api so its raw form is
 * never stored anywhere but the email (outbox payload holds only userId;
 * password_reset_tokens holds only the hash) — see core-api's
 * PasswordResetService for the consuming half.
 *
 * Retry-safe: if the insert commits but the enqueue then fails, the retry
 * mints a second token — harmless, the first was never delivered, and the
 * email is still keyed by outboxId so at most one ever goes out.
 */
export async function handlePasswordResetRequested(_tenantId: string, payload: Record<string, unknown>, outboxId: string): Promise<void> {
  const userId = payload.userId;
  if (typeof userId !== "string") throw new Error(`staff.password_reset_requested payload missing userId: ${JSON.stringify(payload)}`);

  // users/password_reset_tokens aren't RLS-protected — no tenant context.
  const { rows } = await pool.query<{ email: string; name: string }>("SELECT email, name FROM users WHERE id = $1", [userId]);
  const user = rows[0];
  if (!user) {
    console.warn(`[password-reset] user ${userId} not found — skipping`);
    return;
  }

  const rawToken = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [userId, createHash("sha256").update(rawToken).digest("hex"), String(RESET_TOKEN_TTL_MINUTES)],
  );

  await enqueueEmail(`${outboxId}-password-reset`, {
    to: user.email,
    template: "password-reset",
    props: {
      name: user.name,
      resetUrl: `${env.merchantAdminUrl}/reset-password?token=${rawToken}`,
      expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    },
  });
}
