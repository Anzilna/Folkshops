import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { JwtPayload } from "../../auth/auth.service";
import { TenantsService } from "../../tenants/tenants.service";
import { verifyMcpActor } from "./mcp-actor.guard";

/** Staff token (JWT_SECRET, via AuthModule's JwtModule) — see verifyMcpActor. */
@Injectable()
export class StaffMcpGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly tenants: TenantsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    req.user = await verifyMcpActor<JwtPayload>(req, this.jwt, this.tenants);
    return true;
  }
}
