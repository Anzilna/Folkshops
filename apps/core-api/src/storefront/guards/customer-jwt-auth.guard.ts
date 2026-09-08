import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { CUSTOMER_ACCESS_TOKEN_COOKIE } from "../../auth/auth-cookies";
import type { CustomerJwtPayload } from "../customer-auth.service";

declare module "express-serve-static-core" {
  interface Request {
    customer?: CustomerJwtPayload;
  }
}

/**
 * Verifies against StorefrontModule's own JwtModule instance — a separate
 * signing secret (CUSTOMER_JWT_SECRET) from both staff and platform_admin.
 * This boundary matters most of the three: a customer is an unauthenticated
 * member of the public, so a customer token must never be usable against
 * any staff or platform-admin route under any circumstances.
 */
@Injectable()
export class CustomerJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[CUSTOMER_ACCESS_TOKEN_COOKIE];
    if (!token) throw new UnauthorizedException("Missing access token");

    try {
      req.customer = await this.jwt.verifyAsync<CustomerJwtPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
