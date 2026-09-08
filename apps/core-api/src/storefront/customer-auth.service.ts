import { createHash, randomInt } from "node:crypto";
import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { customers, otpCodes } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { TokenService } from "../auth/token.service";
import { OTP_PROVIDER, type OtpProvider } from "./otp-provider";

export interface CustomerJwtPayload {
  sub: string;
  tenantId: string;
  phone: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** OTP codes are low-entropy (6 digits, ~20 bits) unlike refresh tokens — the cooldown+expiry+single-use guards below carry the real security weight, this hash just avoids storing the plaintext code. */
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly dbRouter: DbRouter,
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
    @Inject(OTP_PROVIDER) private readonly otp: OtpProvider,
  ) {}

  /**
   * Per-phone cooldown (not just the route-level ThrottlerGuard in
   * CustomerAuthController) — the guard limits requests per IP, this stops
   * spamming SMS to one specific number from many IPs/devices.
   */
  async requestOtp(tenantId: string, phone: string): Promise<void> {
    await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [recent] = await tx
          .select()
          .from(otpCodes)
          .where(
            and(
              eq(otpCodes.tenantId, tenantId),
              eq(otpCodes.phone, phone),
              gt(otpCodes.createdAt, new Date(Date.now() - OTP_RESEND_COOLDOWN_MS)),
            ),
          )
          .limit(1);
        if (recent) {
          throw new BadRequestException("Please wait before requesting another code");
        }

        const code = generateCode();
        await tx.insert(otpCodes).values({
          tenantId,
          phone,
          codeHash: hashCode(code),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        });
        await this.otp.send(phone, code);
      }),
    );
  }

  /** Creates the customer row on first successful verification — there's no separate signup step. */
  async verifyOtp(tenantId: string, phone: string, code: string): Promise<TokenPair> {
    const invalidMsg = "Invalid or expired code";

    const customer = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [otp] = await tx
          .select()
          .from(otpCodes)
          .where(and(eq(otpCodes.tenantId, tenantId), eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
          .orderBy(desc(otpCodes.createdAt))
          .limit(1);

        if (!otp || otp.expiresAt < new Date() || otp.codeHash !== hashCode(code)) {
          throw new UnauthorizedException(invalidMsg);
        }

        await tx.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, otp.id));

        const [existing] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, phone)))
          .limit(1);
        if (existing) return existing;

        const [created] = await tx.insert(customers).values({ tenantId, phone }).returning();
        return created;
      }),
    );

    return this.issueTokens(customer);
  }

  /** Re-derives the customer record fresh from the DB rather than trusting anything cached in the old token. */
  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const invalidMsg = "Invalid or expired refresh token";
    const consumed = await this.tokens.consumeRefreshToken("customer", rawRefreshToken);
    if (!consumed || !consumed.tenantId) throw new UnauthorizedException(invalidMsg);

    const customer = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, consumed.tenantId!, async (tx) => {
        const [c] = await tx.select().from(customers).where(eq(customers.id, consumed.subjectId)).limit(1);
        return c ?? null;
      }),
    );
    if (!customer) throw new UnauthorizedException(invalidMsg);

    return this.issueTokens(customer);
  }

  /** Not an error if the token is already gone/invalid — logout should always succeed from the client's point of view. */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokens.revokeToken(rawRefreshToken);
  }

  private async issueTokens(customer: { id: string; tenantId: string; phone: string }): Promise<TokenPair> {
    const payload: CustomerJwtPayload = { sub: customer.id, tenantId: customer.tenantId, phone: customer.phone };
    const accessToken = this.jwt.sign(payload);
    const refreshToken = await this.tokens.issueRefreshToken("customer", customer.id, customer.tenantId);
    return { accessToken, refreshToken };
  }
}
