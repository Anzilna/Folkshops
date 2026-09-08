import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { STAFF_ACCESS_TOKEN_COOKIE } from "../auth-cookies";
import type { JwtPayload } from "../auth.service";

declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload;
  }
}

/**
 * Reads the access token from the httpOnly cookie set by AuthController,
 * not an Authorization header — the frontend apps never see the raw token
 * value, so it can't be exfiltrated via XSS the way a JS-readable token
 * (localStorage, or a header the client has to attach manually) could be.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[STAFF_ACCESS_TOKEN_COOKIE];
    if (!token) throw new UnauthorizedException("Missing access token");

    try {
      req.user = await this.jwt.verifyAsync<JwtPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
