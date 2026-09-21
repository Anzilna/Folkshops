import { Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { CurrentCustomer } from "../storefront/decorators/current-customer.decorator";
import type { CustomerJwtPayload } from "../storefront/customer-auth.service";
import { CustomerJwtAuthGuard } from "../storefront/guards/customer-jwt-auth.guard";
import { CustomerTenantMatchGuard } from "../storefront/guards/customer-tenant-match.guard";
import { CheckoutCommand } from "./commands/checkout.command";
import { GetCustomerOrderQuery } from "./queries/get-customer-order.query";
import { ListCustomerOrdersQuery } from "./queries/list-customer-orders.query";

@Controller("storefront/orders")
@UseGuards(CustomerJwtAuthGuard, CustomerTenantMatchGuard)
export class StorefrontOrdersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post("checkout")
  checkout(@CurrentCustomer() customer: CustomerJwtPayload) {
    return this.commandBus.execute(new CheckoutCommand(customer.tenantId, customer.sub));
  }

  @Get()
  list(@CurrentCustomer() customer: CustomerJwtPayload) {
    return this.queryBus.execute(new ListCustomerOrdersQuery(customer.tenantId, customer.sub));
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentCustomer() customer: CustomerJwtPayload) {
    const order = await this.queryBus.execute(new GetCustomerOrderQuery(customer.tenantId, id));
    // Not "belongs to another customer" vs "doesn't exist" — same 404
    // either way, so a customer can't probe for other customers' order ids.
    if (!order || order.customerId !== customer.sub) throw new NotFoundException("Order not found");
    return order;
  }
}
