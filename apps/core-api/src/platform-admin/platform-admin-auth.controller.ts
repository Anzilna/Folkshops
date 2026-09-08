import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
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
import { PlatformAdminJwtAuthGuard } from "./guards/platform-admin-jwt-auth.guard";

const COOKIE_NAMES = { access: PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE, refresh: PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE };

@Controller("platform-admin/auth")
export class PlatformAdminAuthController {
  constructor(private readonly auth: PlatformAdminAuthService) {}

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

  @UseGuards(PlatformAdminJwtAuthGuard)
  @Get("me")
  me(@CurrentPlatformAdmin() admin: PlatformAdminJwtPayload) {
    return { admin };
  }
}
