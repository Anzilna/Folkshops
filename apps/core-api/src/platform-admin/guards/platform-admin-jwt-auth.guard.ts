import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE } from "../../auth/auth-cookies";
import type { PlatformAdminJwtPayload } from "../platform-admin-auth.service";

declare module "express-serve-static-core" {
  interface Request {
    platformAdmin?: PlatformAdminJwtPayload;
  }
}

/**
 * Verifies against PlatformAdminModule's own JwtModule instance — a
 * completely separate signing secret (PLATFORM_ADMIN_JWT_SECRET) from
 * staff/customer auth. A staff-signed access token literally cannot
 * verify here even if somehow presented on this cookie, and vice versa —
 * this is the "separate auth boundary from merchant users" CLAUDE.md
 * calls for, enforced cryptographically rather than by checking a field.
 */
@Injectable()
export class PlatformAdminJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE];
    if (!token) throw new UnauthorizedException("Missing access token");

    try {
      req.platformAdmin = await this.jwt.verifyAsync<PlatformAdminJwtPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
