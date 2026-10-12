import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlansController } from "./plans.controller";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsCoreModule } from "./subscriptions-core.module";

// AuthModule only — never StorefrontModule alongside it (bug #7). PlansController
// carries no guard at all (public), it just lives here for convenience.
@Module({
  imports: [AuthModule, SubscriptionsCoreModule],
  controllers: [PlansController, SubscriptionsController],
})
export class SubscriptionsModule {}
