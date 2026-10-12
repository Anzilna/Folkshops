import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IsString } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { SubscriptionsService } from "./subscriptions.service";

class ChangePlanDto {
  @IsString()
  planSlug!: string;
}

@Controller("subscriptions")
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get("me")
  me(@CurrentTenant() tenant: TenantContext) {
    return this.subscriptions.getForTenant(tenant.id);
  }

  @Post("portal-session")
  portalSession(@CurrentTenant() tenant: TenantContext) {
    return this.subscriptions.createPortalSession(tenant.id);
  }

  @Post("change-plan")
  changePlan(@Body() dto: ChangePlanDto, @CurrentTenant() tenant: TenantContext) {
    return this.subscriptions.changePlan(tenant.id, dto.planSlug);
  }
}
