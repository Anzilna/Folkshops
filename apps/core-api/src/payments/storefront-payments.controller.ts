import { Body, Controller, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentCustomer } from "../storefront/decorators/current-customer.decorator";
import type { CustomerJwtPayload } from "../storefront/customer-auth.service";
import { CustomerJwtAuthGuard } from "../storefront/guards/customer-jwt-auth.guard";
import { CustomerTenantMatchGuard } from "../storefront/guards/customer-tenant-match.guard";
import { PayOrderDto } from "./dto/pay-order.dto";
import { PaymentsService } from "./payments.service";

// Same guard shape as StorefrontOrdersController — a customer paying for
// their own order, not a staff action. No separate "verify-payment"
// route anymore — Stripe Checkout is a redirect flow, not a client-side
// widget with a callback to verify; the webhook is the only confirmation
// path (see PaymentsService.handleWebhookEvent()).
@Controller("storefront/orders")
@UseGuards(CustomerJwtAuthGuard, CustomerTenantMatchGuard)
export class StorefrontPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":orderId/pay")
  async pay(@Param("orderId") orderId: string, @Body() dto: PayOrderDto, @CurrentCustomer() customer: CustomerJwtPayload) {
    const info = await this.payments.initiatePayment(customer.tenantId, orderId, customer.sub, dto.idempotencyKey, dto.returnUrl);
    if (!info) throw new NotFoundException("Order not found");
    return info;
  }
}
