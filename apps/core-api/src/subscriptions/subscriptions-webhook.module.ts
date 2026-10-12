import { Module } from "@nestjs/common";
import { StripeBillingSignatureGuard } from "./guards/stripe-billing-signature.guard";
import { SubscriptionsCoreModule } from "./subscriptions-core.module";
import { SubscriptionsWebhookController } from "./subscriptions-webhook.controller";

// Mirrors PaymentsWebhookModule exactly — SubscriptionsCoreModule only, no
// AuthModule/StorefrontModule, since the webhook needs neither auth
// surface (bug #7 sidestepped, not worked around).
@Module({
  imports: [SubscriptionsCoreModule],
  controllers: [SubscriptionsWebhookController],
  providers: [StripeBillingSignatureGuard],
})
export class SubscriptionsWebhookModule {}
