import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { authSubjectTypeEnum, refreshTokens } from "../database/schema";

export type AuthSubjectType = (typeof authSubjectTypeEnum.enumValues)[number];

const REFRESH_TOKEN_BYTES = 32;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Refresh tokens are high-entropy random values, not low-entropy secrets like passwords — a fast hash is correct here, bcrypt's deliberate slowness buys nothing. */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Shared refresh-token lifecycle for all three auth surfaces (staff,
 * platform_admin, customer). Deliberately knows nothing about JWT claims —
 * each AuthService signs its own access token payload; this only issues,
 * validates, and revokes the opaque refresh token stored in refresh_tokens.
 */
@Injectable()
export class TokenService {
  constructor(private readonly dbRouter: DbRouter) {}

  async issueRefreshToken(subjectType: AuthSubjectType, subjectId: string, tenantId: string | null): Promise<string> {
    const raw = randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
    await this.dbRouter.write((db) =>
      db.insert(refreshTokens).values({
        subjectType,
        subjectId,
        tenantId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      }),
    );
    return raw;
  }

  /**
   * Validates a raw refresh token and revokes it in the same step
   * (rotation-on-use): a stolen-and-replayed token is detected because its
   * row is already revoked, rather than silently reusable until expiry the
   * way a bare long-lived JWT would be. Returns null for anything invalid,
   * expired, or already used — callers should treat all of those alike
   * (force re-login), not distinguish them.
   */
  async consumeRefreshToken(
    subjectType: AuthSubjectType,
    raw: string,
  ): Promise<{ subjectId: string; tenantId: string | null } | null> {
    const tokenHash = hashToken(raw);
    return this.dbRouter.write((db) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(refreshTokens)
          .where(
            and(
              eq(refreshTokens.tokenHash, tokenHash),
              eq(refreshTokens.subjectType, subjectType),
              isNull(refreshTokens.revokedAt),
            ),
          )
          .limit(1);
        if (!row || row.expiresAt < new Date()) return null;

        await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
        return { subjectId: row.subjectId, tenantId: row.tenantId };
      }),
    );
  }

  /** Logout — revoke this one session's refresh token. Not an error if it's already gone/expired/invalid. */
  async revokeToken(raw: string): Promise<void> {
    const tokenHash = hashToken(raw);
    await this.dbRouter.write((db) =>
      db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, tokenHash)),
    );
  }
}
