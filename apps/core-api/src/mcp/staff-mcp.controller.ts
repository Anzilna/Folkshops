import { Controller, Get, HttpCode, MethodNotAllowedException, Post, Req, Res, UseGuards } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { Request, Response } from "express";
import { CustomersService } from "../customers/customers.service";
import { InventoryService } from "../inventory/inventory.service";
import { InternalServiceGuard } from "./guards/internal-service.guard";
import { StaffMcpGuard } from "./guards/staff-mcp.guard";
import { newMcpServer, serveMcpRequest } from "./mcp-http";
import { registerStaffTools } from "./staff-tools";

/**
 * MCP endpoint for the Store Copilot — reachable only by ai-service
 * (InternalServiceGuard) acting for one verified staff member
 * (StaffMcpGuard). Never routed by a public proxy: the storefront/admin
 * Next.js rewrites don't forward /internal/*.
 */
@Controller("internal/mcp/staff")
@UseGuards(InternalServiceGuard, StaffMcpGuard)
export class StaffMcpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly inventory: InventoryService,
    private readonly customers: CustomersService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const server = newMcpServer("folkshops-staff");
    registerStaffTools(server, req.tenantContext!.id, {
      commandBus: this.commandBus,
      queryBus: this.queryBus,
      inventory: this.inventory,
      customers: this.customers,
    });
    await serveMcpRequest(req, res, server);
  }

  // Stateless JSON mode: there is no standalone SSE stream to open (GET),
  // and no session to terminate, so the client never sends DELETE.
  @Get()
  @HttpCode(405)
  notAllowed() {
    throw new MethodNotAllowedException();
  }
}
