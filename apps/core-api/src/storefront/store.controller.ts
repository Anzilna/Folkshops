import { BadRequestException, Controller, Get } from "@nestjs/common";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";

/**
 * The one public, unauthenticated fact about a store the storefront needs
 * before anyone logs in: its display name. Everything else about a tenant
 * (status, ids of other tenants, ...) stays behind platform-admin auth —
 * this returns only what the resolved hostname already implies.
 */
@Controller("storefront/store")
export class StoreController {
  @Get()
  get(@CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    return { name: tenant.name, slug: tenant.slug };
  }
}
