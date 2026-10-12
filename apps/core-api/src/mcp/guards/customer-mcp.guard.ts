import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { CustomerJwtPayload } from "../../storefront/customer-auth.service";
import { TenantsService } from "../../tenants/tenants.service";
import { verifyMcpActor } from "./mcp-actor.guard";

/** Customer token (CUSTOMER_JWT_SECRET, via StorefrontModule's JwtModule) — see verifyMcpActor. */
@Injectable()
export class CustomerMcpGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly tenants: TenantsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    req.customer = await verifyMcpActor<CustomerJwtPayload>(req, this.jwt, this.tenants);
    return true;
  }
}
