import { createHash, timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

export const INTERNAL_SERVICE_HEADER = "x-internal-service-token";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * The first of the two credentials every /internal/mcp/* request needs:
 * proof the caller is ai-service, not a browser or anything else that can
 * reach core-api. The second (the user's own access token) is checked by
 * McpActorGuard. Neither alone is enough — a stolen user token can't reach
 * these routes without the service secret, and ai-service can't act as a
 * user without that user's token.
 *
 * Fails closed: with INTERNAL_SERVICE_TOKEN unset, every request is
 * rejected, so forgetting the env var disables MCP rather than opening it.
 * Both sides are hashed before timingSafeEqual so the comparison doesn't
 * leak the secret's length either.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("INTERNAL_SERVICE_TOKEN");
    if (!expected) throw new ForbiddenException("Internal MCP endpoint is not configured");

    const req = context.switchToHttp().getRequest<Request>();
    const given = req.header(INTERNAL_SERVICE_HEADER);
    if (!given || !timingSafeEqual(sha256(given), sha256(expected))) {
      throw new UnauthorizedException("Invalid internal service credential");
    }
    return true;
  }
}
