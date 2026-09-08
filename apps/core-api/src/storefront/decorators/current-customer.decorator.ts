import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { CustomerJwtPayload } from "../customer-auth.service";

export const CurrentCustomer = createParamDecorator((_: unknown, ctx: ExecutionContext): CustomerJwtPayload => {
  return ctx.switchToHttp().getRequest<Request>().customer!;
});
