import { Module } from "@nestjs/common";
import { RazorpayProvider } from "./providers/razorpay.provider";
import { PAYMENT_GATEWAY } from "./payment-provider.interface";
import { PaymentsService } from "./payments.service";

/**
 * Shared (imported by both StorefrontPaymentsModule and
 * PaymentsWebhookModule) rather than duplicated the way OrdersService is
 * between OrdersModule/StorefrontOrdersModule. That duplication exists
 * specifically to avoid two different JwtModule registrations colliding
 * (CLAUDE.md bug #7) — this module never touches JwtModule/AuthModule/
 * StorefrontModule at all, only DbRouter (global, from DatabaseModule)
 * and ConfigService, so that specific collision risk doesn't apply here.
 * Sharing it avoids constructing a second Razorpay client per module for
 * no reason. A deliberate, reasoned deviation from the OrdersService
 * precedent, not an oversight.
 */
@Module({
  providers: [PaymentsService, { provide: PAYMENT_GATEWAY, useClass: RazorpayProvider }],
  exports: [PaymentsService],
})
export class PaymentsCoreModule {}
