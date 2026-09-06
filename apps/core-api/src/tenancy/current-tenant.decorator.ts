import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { TenantContext } from "./tenant-resolver.middleware";

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantContext | undefined => {
    return ctx.switchToHttp().getRequest<Request>().tenantContext;
  },
);
