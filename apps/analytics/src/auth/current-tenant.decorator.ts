import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

/**
 * The ONLY source of tenant for every analytics endpoint — reads the
 * tenantId claim off the JWT StaffJwtGuard already verified. No endpoint
 * in this service accepts a tenantId query param; a request can never
 * specify which tenant's data it wants to see, only prove (via a valid
 * cookie) which tenant it's allowed to see.
 */
export const CurrentTenant = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const req = context.switchToHttp().getRequest<Request>();
  if (!req.staffUser) {
    // Should be unreachable if StaffJwtGuard runs first, but never trust
    // guard ordering silently — fail closed, not open.
    throw new UnauthorizedException("No authenticated staff user on request");
  }
  return req.staffUser.tenantId;
});
