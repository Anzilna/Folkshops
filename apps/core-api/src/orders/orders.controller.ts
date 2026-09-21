import { Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { QueryOrdersDto } from "./dto/query-orders.dto";
import { OrdersService } from "./orders.service";
import { GetOrderQuery } from "./queries/get-order.query";
import { ListOrdersQuery } from "./queries/list-orders.query";

// Staff-facing, read-only — orders are created by customers via checkout
// (StorefrontOrdersController), never by staff directly. No import
// endpoint — see OrdersService's comment for why.
@Controller("orders")
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class OrdersController {
  // OrdersService still injected directly — exportCsv() below is
  // unchanged (streams a CSV to Response, doesn't fit the
  // return-a-value Query shape, no Query was introduced for it).
  constructor(
    private readonly orders: OrdersService,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  list(@Query() query: QueryOrdersDto, @CurrentTenant() tenant: TenantContext) {
    return this.queryBus.execute(new ListOrdersQuery(tenant.id, query));
  }

  // Before ":id" — see ProductsController's exportCsv for why the order matters.
  @Get("export")
  async exportCsv(@Query() query: QueryOrdersDto, @CurrentTenant() tenant: TenantContext, @Res() res: Response) {
    const csv = await this.orders.exportCsv(tenant.id, query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="orders-${tenant.slug}.csv"`);
    res.send(csv);
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentTenant() tenant: TenantContext) {
    const order = await this.queryBus.execute(new GetOrderQuery(tenant.id, id));
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }
}
