import { BadRequestException, Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { clearAuthCookies, setAuthCookies, STAFF_ACCESS_TOKEN_COOKIE, STAFF_REFRESH_TOKEN_COOKIE } from "./auth-cookies";

const COOKIE_NAMES = { access: STAFF_ACCESS_TOKEN_COOKIE, refresh: STAFF_REFRESH_TOKEN_COOKIE };
import { AuthService, JwtPayload } from "./auth.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { IdentifyDto } from "./dto/identify.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { TenantMatchGuard } from "./guards/tenant-match.guard";
import { PasswordResetService } from "./password-reset.service";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import { AllowSuspendedStore } from "../tenancy/store-available.guard";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post("register")
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { tokens, ...body } = await this.auth.register(dto);
    setAuthCookies(res, COOKIE_NAMES, tokens);
    return body;
  }

  // IP-scoped rate limit — this is the one route in the app whose entire
  // job is answering "does an account exist for this email, and where" (a
  // narrower version of what any login form already reveals via its
  // error message, but automatable at scale if left unthrottled). No
  // tenant, no CurrentTenant() — it runs before any tenant is known.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("identify")
  async identify(@Body() dto: IdentifyDto) {
    return { stores: await this.auth.identify(dto.email) };
  }

  // Same IP throttle as identify(); PasswordResetService adds a per-email
  // cooldown on top. Identical response whether or not the email exists.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("forgot-password")
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordReset.requestReset(dto.email);
    return { ok: true };
  }

  // Throttled too — the token is 256 bits so guessing is hopeless, but
  // there's no reason to let anyone try at full speed.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("reset-password")
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordReset.resetPassword(dto.token, dto.password);
    return { ok: true };
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

  @AllowSuspendedStore()
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
