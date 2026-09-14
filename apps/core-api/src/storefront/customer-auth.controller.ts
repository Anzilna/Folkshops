import { BadRequestException, Body, Controller, Get, Patch, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  clearAuthCookies,
  CUSTOMER_ACCESS_TOKEN_COOKIE,
  CUSTOMER_REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from "../auth/auth-cookies";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { CurrentCustomer } from "./decorators/current-customer.decorator";
import { CustomerAuthService, CustomerJwtPayload } from "./customer-auth.service";
import { CustomerJwtAuthGuard } from "./guards/customer-jwt-auth.guard";
import { CustomerTenantMatchGuard } from "./guards/customer-tenant-match.guard";
import { RequestOtpDto } from "./dto/request-otp.dto";
import { UpdateMeDto } from "./dto/update-me.dto";
import { VerifyOtpDto } from "./dto/verify-otp.dto";

const COOKIE_NAMES = { access: CUSTOMER_ACCESS_TOKEN_COOKIE, refresh: CUSTOMER_REFRESH_TOKEN_COOKIE };

@Controller("storefront/auth")
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  // IP-scoped, on top of CustomerAuthService's own per-phone cooldown —
  // an SMS is sent on every call to this route, so it's both a cost and an
  // abuse surface distinct from every other endpoint in the app. Overrides
  // the globally-registered "default" throttler's limit for this route
  // specifically — much stricter than the app-wide baseline (AppModule).
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("otp/request")
  async requestOtp(@Body() dto: RequestOtpDto, @CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    await this.auth.requestOtp(tenant.id, dto.phone);
    return { ok: true };
  }

  @Post("otp/verify")
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @CurrentTenant() tenant: TenantContext | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    const tokens = await this.auth.verifyOtp(tenant.id, dto.phone, dto.code);
    setAuthCookies(res, COOKIE_NAMES, tokens);
    return { ok: true };
  }

  // No guard here — the whole point is exchanging an about-to-expire (or
  // already-expired) access token's refresh cookie for a new pair.
  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[CUSTOMER_REFRESH_TOKEN_COOKIE];
    if (!raw) throw new UnauthorizedException("Missing refresh token");
    const tokens = await this.auth.refresh(raw);
    setAuthCookies(res, COOKIE_NAMES, tokens);
    return { ok: true };
  }

  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[CUSTOMER_REFRESH_TOKEN_COOKIE];
    if (raw) await this.auth.logout(raw);
    clearAuthCookies(res, COOKIE_NAMES);
    return { ok: true };
  }

  @UseGuards(CustomerJwtAuthGuard, CustomerTenantMatchGuard)
  @Get("me")
  async me(@CurrentCustomer() customer: CustomerJwtPayload, @CurrentTenant() tenant?: TenantContext) {
    // customer (the JWT payload) has no `name` — see findById()'s comment.
    const row = await this.auth.findById(customer.tenantId, customer.sub);
    return { customer: { ...customer, name: row?.name ?? null }, tenant };
  }

  @UseGuards(CustomerJwtAuthGuard, CustomerTenantMatchGuard)
  @Patch("me")
  updateMe(@Body() dto: UpdateMeDto, @CurrentCustomer() customer: CustomerJwtPayload) {
    return this.auth.updateName(customer.tenantId, customer.sub, dto.name);
  }
}
