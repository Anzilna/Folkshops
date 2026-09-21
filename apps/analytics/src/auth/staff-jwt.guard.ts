import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import jwt from "jsonwebtoken";

// Must match apps/core-api/src/auth/auth-cookies.ts's STAFF_ACCESS_TOKEN_COOKIE
// exactly — this service verifies the same cookie core-api issues, it
// never issues its own.
const STAFF_ACCESS_TOKEN_COOKIE = "fk_access_token";

export interface StaffJwtPayload {
  sub: string;
  tenantId: string;
  role: string;
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    staffUser?: StaffJwtPayload;
  }
}

/**
 * A minimal reimplementation of core-api's JwtAuthGuard, not a shared
 * runtime import — apps/analytics is a separate deployable, and core-api's
 * guards live inside its own NestJS module graph (not cross-process
 * importable). This mirrors the project's existing precedent of
 * duplicating small cross-boundary helpers rather than reaching across an
 * app boundary that isn't a real package (e.g. apps/workers' own
 * withTenantContext vs core-api's).
 *
 * Deliberately uses `jsonwebtoken.verify` directly, not `@nestjs/jwt`'s
 * JwtService — a single verify call doesn't need JwtModule's registration
 * ceremony, and skipping it entirely sidesteps any risk of recreating
 * CLAUDE.md bug #7 (two differently-secreted JwtModules colliding) in a
 * brand-new codebase.
 *
 * Unlike core-api, this service is NEVER hit directly by the browser
 * (merchant-admin proxies to it — see apps/merchant-admin/next.config.ts's
 * rewrites()), so it needs no hostname/subdomain tenant resolution at
 * all — tenant comes solely from this verified JWT's own tenantId claim,
 * via @CurrentTenant().
 */
@Injectable()
export class StaffJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[STAFF_ACCESS_TOKEN_COOKIE];
    if (!token) throw new UnauthorizedException("Missing access token");

    try {
      req.staffUser = jwt.verify(token, process.env.JWT_SECRET!) as StaffJwtPayload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
