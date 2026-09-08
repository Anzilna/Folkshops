import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { PlatformAdminJwtPayload } from "../platform-admin-auth.service";

export const CurrentPlatformAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformAdminJwtPayload => {
    return ctx.switchToHttp().getRequest<Request>().platformAdmin!;
  },
);
