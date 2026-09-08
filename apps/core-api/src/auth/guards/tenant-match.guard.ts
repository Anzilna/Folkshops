import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";

/**
 * A valid JWT for tenant A must not authorize a request against tenant B's
 * host just because the token is well-formed — this cross-checks the
 * token's tenantId against the tenant resolved from *this* request
 * (rule 7's "tenant resolution" layer, independent of RLS). Run after
 * JwtAuthGuard so req.user is populated.
 */
@Injectable()
export class TenantMatchGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.tenantContext) {
      throw new ForbiddenException("No store resolved for this request");
    }
    if (req.user?.tenantId !== req.tenantContext.id) {
      throw new ForbiddenException("Token does not belong to this store");
    }
    return true;
  }
}
