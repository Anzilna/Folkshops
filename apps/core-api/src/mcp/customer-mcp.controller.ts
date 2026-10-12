import { Controller, Get, HttpCode, MethodNotAllowedException, Post, Req, Res, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { Request, Response } from "express";
import { CartService } from "../cart/cart.service";
import { registerCustomerTools } from "./customer-tools";
import { CustomerMcpGuard } from "./guards/customer-mcp.guard";
import { InternalServiceGuard } from "./guards/internal-service.guard";
import { newMcpServer, serveMcpRequest } from "./mcp-http";

/** MCP endpoint for the Shopper Assistant — see StaffMcpController. */
@Controller("internal/mcp/customer")
@UseGuards(InternalServiceGuard, CustomerMcpGuard)
export class CustomerMcpController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly cart: CartService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const server = newMcpServer("folkshops-customer");
    registerCustomerTools(server, req.tenantContext!.id, req.customer!.sub, { queryBus: this.queryBus, cart: this.cart });
    await serveMcpRequest(req, res, server);
  }

  @Get()
  @HttpCode(405)
  notAllowed() {
    throw new MethodNotAllowedException();
  }
}
