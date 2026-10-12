import { Module } from "@nestjs/common";
import { BILLING_GATEWAY } from "./billing-provider.interface";
import { PlanLimitsService } from "./plan-limits.service";
import { PlansService } from "./plans.service";
import { StripeBillingProvider } from "./providers/stripe-billing.provider";
import { SubscriptionsService } from "./subscriptions.service";

/**
 * Providers only, no controllers — same shape as PaymentsCoreModule, for
 * the same reason: AuthModule (register()'s Stripe customer/checkout
 * call) and ProductsModule (PlanLimitsService's product-count check) both
 * need these providers without pulling in a controller/guard graph.
 */
@Module({
  providers: [
    PlansService,
    PlanLimitsService,
    SubscriptionsService,
    { provide: BILLING_GATEWAY, useClass: StripeBillingProvider },
  ],
  exports: [PlansService, PlanLimitsService, SubscriptionsService, BILLING_GATEWAY],
})
export class SubscriptionsCoreModule {}
