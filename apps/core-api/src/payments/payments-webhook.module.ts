import { Module } from "@nestjs/common";
import { PaymentsCoreModule } from "./payments-core.module";
import { PaymentsWebhookController } from "./payments-webhook.controller";
import { RazorpaySignatureGuard } from "./guards/razorpay-signature.guard";

// PaymentsCoreModule only — no AuthModule/StorefrontModule, since the
// webhook needs neither auth surface at all. This sidesteps bug #7's
// JwtService DI collision entirely rather than working around it, the
// same way OrdersModule/StorefrontOrdersModule avoid it by never being
// imported into the same module as each other.
@Module({
  imports: [PaymentsCoreModule],
  controllers: [PaymentsWebhookController],
  providers: [RazorpaySignatureGuard],
})
export class PaymentsWebhookModule {}
