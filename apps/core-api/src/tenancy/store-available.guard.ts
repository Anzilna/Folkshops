import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

const ALLOW_SUSPENDED_KEY = "allowSuspendedStore";

/**
 * Marks a route that must keep working for a suspended store — today only
 * logout, so a suspended merchant or shopper can still clear their own
 * session instead of being stuck holding cookies the app can no longer use.
 */
export const AllowSuspendedStore = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);

export const STORE_SUSPENDED_CODE = "store_suspended";

/**
 * Global (APP_GUARD, see TenancyModule): refuses every request that
 * resolves to a suspended store — storefront, staff and customer auth,
 * catalog reads, all of it — before any controller guard runs. One front
 * door rather than a check sprinkled across modules, so a new route can't
 * forget it.
 *
 * Requests with no store context at all (platform-admin routes, health,
 * Stripe webhooks, the /internal/mcp/* endpoints) never reach this branch;
 * the layers that don't go through a store host re-check status
 * themselves (AuthService.login/refresh, McpActorGuard, ai-service's
 * entitlement check). The `code` lets frontends show a "store suspended"
 * page instead of a generic error.
 */
@Injectable()
export class StoreAvailableGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.tenantContext?.status !== "suspended") return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_KEY, [context.getHandler(), context.getClass()]);
    if (allowed) return true;

    throw new ForbiddenException({
      statusCode: 403,
      code: STORE_SUSPENDED_CODE,
      message: "This store is currently suspended. Please contact Folkshops support.",
    });
  }
}
