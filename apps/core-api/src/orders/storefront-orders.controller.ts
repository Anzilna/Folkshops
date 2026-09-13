import { Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentCustomer } from "../storefront/decorators/current-customer.decorator";
import type { CustomerJwtPayload } from "../storefront/customer-auth.service";
import { CustomerJwtAuthGuard } from "../storefront/guards/customer-jwt-auth.guard";
import { CustomerTenantMatchGuard } from "../storefront/guards/customer-tenant-match.guard";
import { OrdersService } from "./orders.service";

@Controller("storefront/orders")
@UseGuards(CustomerJwtAuthGuard, CustomerTenantMatchGuard)
export class StorefrontOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post("checkout")
  checkout(@CurrentCustomer() customer: CustomerJwtPayload) {
    return this.orders.checkout(customer.tenantId, customer.sub);
  }

  @Get()
  list(@CurrentCustomer() customer: CustomerJwtPayload) {
    return this.orders.listForCustomer(customer.tenantId, customer.sub);
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentCustomer() customer: CustomerJwtPayload) {
    const order = await this.orders.findById(customer.tenantId, id);
    // Not "belongs to another customer" vs "doesn't exist" — same 404
    // either way, so a customer can't probe for other customers' order ids.
    if (!order || order.customerId !== customer.sub) throw new NotFoundException("Order not found");
    return order;
  }
}
