import { BadRequestException, Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentAccountsService } from "../payments/payment-accounts.service";
import { CacheService } from "../redis/cache.service";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { storeCacheKey } from "./store-cache";

/**
 * The public, unauthenticated facts about a store the storefront needs
 * before anyone logs in: its display name, and whether it can currently
 * accept payments. Everything else about a tenant (status, ids of other
 * tenants, ...) stays behind platform-admin auth — this returns only what
 * the resolved hostname already implies. paymentsEnabled drives the
 * storefront's own UI gate (hide "Continue to payment" if false), but it
 * is NOT the enforcement — PaymentsService.initiatePayment() checks the
 * same underlying flag server-side before ever calling Stripe, since a
 * hidden button is not security.
 *
 * Cached, cache-aside, key `store:{tenantId}` — this is hit on every
 * single storefront page load (root layout.tsx) for every anonymous
 * visitor, and its own two inputs (tenant.name, paymentsEnabled) change
 * rarely. `tenant` itself is NOT re-fetched from the cache — it's already
 * resolved per-request by TenantResolverMiddleware, which stays
 * deliberately uncached (see CacheService's own comment); only the
 * *response this controller assembles* is cached, keyed by the tenant id
 * that resolution already produced.
 */
@Controller("storefront/store")
export class StoreController {
  private readonly ttlSeconds: number;

  constructor(
    private readonly paymentAccounts: PaymentAccountsService,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    this.ttlSeconds = Number(config.get<string>("CACHE_STORE_TTL_SECONDS") ?? 300);
  }

  @Get()
  async get(@CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    return this.cache.getOrSet(storeCacheKey(tenant.id), this.ttlSeconds, async () => {
      const paymentsEnabled = await this.paymentAccounts.isPaymentsEnabled(tenant.id);
      return { name: tenant.name, slug: tenant.slug, paymentsEnabled };
    });
  }
}
