import { Controller, Get, NotFoundException, Param, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { OrdersService } from "./orders.service";

// Staff-facing, read-only — orders are created by customers via checkout
// (StorefrontOrdersController), never by staff directly.
@Controller("orders")
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.orders.listForTenant(tenant.id);
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentTenant() tenant: TenantContext) {
    const order = await this.orders.findById(tenant.id, id);
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }
}
