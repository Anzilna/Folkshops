import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  clearAuthCookies,
  PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE,
  PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from "../auth/auth-cookies";
import { CurrentPlatformAdmin } from "./decorators/current-platform-admin.decorator";
import { LoginDto } from "./dto/login.dto";
import { PlatformAdminAuthService, PlatformAdminJwtPayload } from "./platform-admin-auth.service";
import { ChangePasswordDto } from "./team/platform-admin-team.dto";
import { PlatformAdminTeamService } from "./team/platform-admin-team.service";
import { PlatformAdminJwtAuthGuard } from "./guards/platform-admin-jwt-auth.guard";

const COOKIE_NAMES = { access: PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE, refresh: PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE };

@Controller("platform-admin/auth")
export class PlatformAdminAuthController {
  constructor(
    private readonly auth: PlatformAdminAuthService,
    private readonly team: PlatformAdminTeamService,
  ) {}

  // Throttled: this is the platform's highest-privilege login, and until
  // now nothing slowed down guessing at it.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(dto);
    setAuthCookies(res, COOKIE_NAMES, tokens);
    return { ok: true };
  }

  // No guard here — the whole point is exchanging an about-to-expire (or
  // already-expired) access token's refresh cookie for a new pair.
  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE];
    if (!raw) throw new UnauthorizedException("Missing refresh token");
    const tokens = await this.auth.refresh(raw);
    setAuthCookies(res, COOKIE_NAMES, tokens);
    return { ok: true };
  }

  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE];
    if (raw) await this.auth.logout(raw);
    clearAuthCookies(res, COOKIE_NAMES);
    return { ok: true };
  }

  /**
   * Signs the account out everywhere (every refresh token revoked), then
   * gives THIS browser a fresh session so the admin isn't bounced to login
   * by their own password change. Other devices' access tokens still work
   * for the minutes they have left (a JWT can't be recalled) but can't
   * refresh.
   */
  @UseGuards(ThrottlerGuard, PlatformAdminJwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("change-password")
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentPlatformAdmin() admin: PlatformAdminJwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.team.changePassword(admin.sub, dto);
    setAuthCookies(res, COOKIE_NAMES, await this.auth.issueSession(admin.sub));
    return { ok: true };
  }

  @UseGuards(PlatformAdminJwtAuthGuard)
  @Get("me")
  me(@CurrentPlatformAdmin() admin: PlatformAdminJwtPayload) {
    return { admin };
  }
}
