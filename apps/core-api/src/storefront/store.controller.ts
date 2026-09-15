import { BadRequestException, Controller, Get } from "@nestjs/common";
import { PaymentAccountsService } from "../payments/payment-accounts.service";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";

/**
 * The public, unauthenticated facts about a store the storefront needs
 * before anyone logs in: its display name, and whether it can currently
 * accept payments. Everything else about a tenant (status, ids of other
 * tenants, ...) stays behind platform-admin auth — this returns only what
 * the resolved hostname already implies. paymentsEnabled drives the
 * storefront's own UI gate (hide "Continue to payment" if false), but it
 * is NOT the enforcement — PaymentsService.initiatePayment() checks the
 * same underlying flag server-side before ever calling Razorpay, since a
 * hidden button is not security.
 */
@Controller("storefront/store")
export class StoreController {
  constructor(private readonly paymentAccounts: PaymentAccountsService) {}

  @Get()
  async get(@CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    const paymentsEnabled = await this.paymentAccounts.isPaymentsEnabled(tenant.id);
    return { name: tenant.name, slug: tenant.slug, paymentsEnabled };
  }
}
