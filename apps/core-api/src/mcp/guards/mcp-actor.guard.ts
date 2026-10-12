import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { TenantsService } from "../../tenants/tenants.service";

/**
 * Shared by StaffMcpGuard and CustomerMcpGuard. Two differences from the
 * browser-facing guards, both because ai-service (not a browser) is the
 * caller:
 *
 * 1. The token arrives as `Authorization: Bearer`, not a cookie. Only these
 *    internal routes accept a header token — JwtAuthGuard/
 *    CustomerJwtAuthGuard stay cookie-only for every browser route.
 * 2. The tenant comes from the verified token's tenantId, not the Host
 *    header: there's no store subdomain on a service-to-service call.
 *    TenantResolverMiddleware may have set req.tenantContext from a dev
 *    X-Tenant-Id header already — it's overwritten here unconditionally,
 *    so nothing but the verified token decides the tenant.
 */
export async function verifyMcpActor<T extends { tenantId: string }>(
  req: Request,
  jwt: JwtService,
  tenants: TenantsService,
): Promise<T> {
  const match = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
  if (!match) throw new UnauthorizedException("Missing bearer token");

  let payload: T;
  try {
    payload = await jwt.verifyAsync<T>(match[1]);
  } catch {
    throw new UnauthorizedException("Invalid or expired token");
  }

  const tenant = await tenants.findById(payload.tenantId);
  if (!tenant || tenant.status !== "active") throw new ForbiddenException("Store is not available");
  req.tenantContext = { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status };
  return payload;
}
