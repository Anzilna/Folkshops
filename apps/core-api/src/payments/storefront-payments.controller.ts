import { Body, Controller, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentCustomer } from "../storefront/decorators/current-customer.decorator";
import type { CustomerJwtPayload } from "../storefront/customer-auth.service";
import { CustomerJwtAuthGuard } from "../storefront/guards/customer-jwt-auth.guard";
import { CustomerTenantMatchGuard } from "../storefront/guards/customer-tenant-match.guard";
import { PayOrderDto } from "./dto/pay-order.dto";
import { VerifyPaymentDto } from "./dto/verify-payment.dto";
import { PaymentsService } from "./payments.service";

// Same guard shape as StorefrontOrdersController — a customer paying for
// their own order, not a staff action.
@Controller("storefront/orders")
@UseGuards(CustomerJwtAuthGuard, CustomerTenantMatchGuard)
export class StorefrontPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":orderId/pay")
  async pay(@Param("orderId") orderId: string, @Body() dto: PayOrderDto, @CurrentCustomer() customer: CustomerJwtPayload) {
    const info = await this.payments.initiatePayment(customer.tenantId, orderId, customer.sub, dto.idempotencyKey);
    if (!info) throw new NotFoundException("Order not found");
    return info;
  }

  @Post(":orderId/verify-payment")
  verifyPayment(@Param("orderId") orderId: string, @Body() dto: VerifyPaymentDto, @CurrentCustomer() customer: CustomerJwtPayload) {
    return this.payments.verifyClientPayment(customer.tenantId, orderId, customer.sub, dto);
  }
}
