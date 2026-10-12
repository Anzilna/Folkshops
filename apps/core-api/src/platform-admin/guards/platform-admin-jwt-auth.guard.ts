import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE } from "../../auth/auth-cookies";
import type { PlatformAdminJwtPayload } from "../platform-admin-auth.service";
import { PlatformAdminsService } from "../platform-admins.service";

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
  constructor(
    private readonly jwt: JwtService,
    private readonly admins: PlatformAdminsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE];
    if (!token) throw new UnauthorizedException("Missing access token");

    let payload: PlatformAdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformAdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    // A removed admin loses access on their very next request, not when
    // their (up to 15-minute) access token runs out: one primary-key lookup
    // per request, on an internal tool, is a fair price for that.
    if (!(await this.admins.findById(payload.sub))) throw new UnauthorizedException("This account no longer exists");

    req.platformAdmin = payload;
    return true;
  }
}
