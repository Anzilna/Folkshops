import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { TokenService } from "../auth/token.service";
import { PlatformAdminsService } from "./platform-admins.service";

export interface PlatformAdminJwtPayload {
  sub: string;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * No register() here on purpose — platform admins are internal Folkshops
 * staff, provisioned via scripts/bootstrap-platform-admin.ts (an operator
 * running a script with real credentials), never a public signup form.
 */
@Injectable()
export class PlatformAdminAuthService {
  constructor(
    private readonly admins: PlatformAdminsService,
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
  ) {}

  async login(input: { email: string; password: string }): Promise<TokenPair> {
    const admin = await this.admins.findByEmail(input.email);
    if (!admin || !(await bcrypt.compare(input.password, admin.passwordHash))) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return this.issueTokens(admin.id, admin.email);
  }

  /** Re-derives the admin record fresh from the DB rather than trusting anything cached in the old token. */
  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const invalidMsg = "Invalid or expired refresh token";
    const consumed = await this.tokens.consumeRefreshToken("platform_admin", rawRefreshToken);
    if (!consumed) throw new UnauthorizedException(invalidMsg);

    const admin = await this.admins.findById(consumed.subjectId);
    if (!admin) throw new UnauthorizedException(invalidMsg);

    return this.issueTokens(admin.id, admin.email);
  }

  /** Not an error if the token is already gone/invalid — logout should always succeed from the client's point of view. */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokens.revokeToken(rawRefreshToken);
  }

  private async issueTokens(id: string, email: string): Promise<TokenPair> {
    const payload: PlatformAdminJwtPayload = { sub: id, email };
    const accessToken = this.jwt.sign(payload);
    // tenantId is always null here — platform admins are global, not scoped to a store.
    const refreshToken = await this.tokens.issueRefreshToken("platform_admin", id, null);
    return { accessToken, refreshToken };
  }
}
