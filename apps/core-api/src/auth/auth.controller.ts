import { BadRequestException, Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AuthService, JwtPayload } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { TenantMatchGuard } from "./tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post("login")
  login(@Body() dto: LoginDto, @CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    return this.auth.login({ ...dto, tenantId: tenant.id });
  }

  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  @Get("me")
  me(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant?: TenantContext) {
    return { user, tenant };
  }
}
