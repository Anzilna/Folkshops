import { BadRequestException, Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { clearAuthCookies, setAuthCookies, STAFF_ACCESS_TOKEN_COOKIE, STAFF_REFRESH_TOKEN_COOKIE } from "./auth-cookies";

const COOKIE_NAMES = { access: STAFF_ACCESS_TOKEN_COOKIE, refresh: STAFF_REFRESH_TOKEN_COOKIE };
import { AuthService, JwtPayload } from "./auth.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { TenantMatchGuard } from "./guards/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { tokens, ...body } = await this.auth.register(dto);
    setAuthCookies(res, COOKIE_NAMES, tokens);
    return body;
  }

  @Post("login")
  async login(@Body() dto: LoginDto, @CurrentTenant() tenant: TenantContext | undefined, @Res({ passthrough: true }) res: Response) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    const { tokens } = await this.auth.login({ ...dto, tenantId: tenant.id });
    setAuthCookies(res, COOKIE_NAMES, tokens);
    return { ok: true };
  }

  // No JwtAuthGuard here — the whole point is exchanging an about-to-expire
  // (or already-expired) access token's refresh cookie for a new pair.
  @Post("refresh")
  async refreshTokens(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[STAFF_REFRESH_TOKEN_COOKIE];
    if (!raw) throw new UnauthorizedException("Missing refresh token");
    const tokens = await this.auth.refresh(raw);
    setAuthCookies(res, COOKIE_NAMES, tokens);
    return { ok: true };
  }

  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[STAFF_REFRESH_TOKEN_COOKIE];
    if (raw) await this.auth.logout(raw);
    clearAuthCookies(res, COOKIE_NAMES);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  @Get("me")
  me(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant?: TenantContext) {
    return { user, tenant };
  }
}
