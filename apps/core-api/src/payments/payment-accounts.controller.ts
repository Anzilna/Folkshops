import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import type { JwtPayload } from "../auth/auth.service";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
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

  // "Connect Stripe" — creates the connected account on first call,
  // always returns a fresh hosted onboarding URL to redirect to. No body:
  // Stripe's own onboarding form collects every business/KYC field
  // itself, there's nothing for the client to submit here — the one field
  // v2's account creation itself requires (contact_email) comes from the
  // logged-in staff member's own session, not a new form field.
  @Post("connect")
  connect(@CurrentTenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    return this.paymentAccounts.connect(tenant.id, user.email);
  }

  @Post("refresh")
  refresh(@CurrentTenant() tenant: TenantContext) {
    return this.paymentAccounts.refreshStatus(tenant.id);
  }
}
