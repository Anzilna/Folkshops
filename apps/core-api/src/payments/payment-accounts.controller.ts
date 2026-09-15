import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { CreatePaymentAccountDto } from "./dto/create-payment-account.dto";
import { PaymentAccountsService } from "./payment-accounts.service";

// Staff-only, same guard shape as ProductsController's mutation routes —
// no RBAC restriction (matches the project-wide deferred RolesGuard),
// any authenticated member of the tenant can set this up.
@Controller("payment-accounts")
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class PaymentAccountsController {
  constructor(private readonly paymentAccounts: PaymentAccountsService) {}

  @Get("me")
  getMine(@CurrentTenant() tenant: TenantContext) {
    return this.paymentAccounts.getForTenant(tenant.id);
  }

  @Post()
  create(@Body() dto: CreatePaymentAccountDto, @CurrentTenant() tenant: TenantContext) {
    return this.paymentAccounts.create(tenant.id, dto);
  }

  @Post("refresh")
  refresh(@CurrentTenant() tenant: TenantContext) {
    return this.paymentAccounts.refreshStatus(tenant.id);
  }
}
