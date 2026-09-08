import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";

/**
 * Same reasoning as auth/guards/tenant-match.guard.ts: a valid customer token for
 * store A must not authorize a request against store B's host just because
 * the token is well-formed. Run after CustomerJwtAuthGuard so req.customer
 * is populated.
 */
@Injectable()
export class CustomerTenantMatchGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.tenantContext) {
      throw new ForbiddenException("No store resolved for this request");
    }
    if (req.customer?.tenantId !== req.tenantContext.id) {
      throw new ForbiddenException("Token does not belong to this store");
    }
    return true;
  }
}
