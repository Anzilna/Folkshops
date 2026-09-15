import { Module } from "@nestjs/common";
import { StorefrontModule } from "../storefront/storefront.module";
import { PaymentsCoreModule } from "./payments-core.module";
import { StorefrontPaymentsController } from "./storefront-payments.controller";

@Module({
  imports: [StorefrontModule, PaymentsCoreModule],
  controllers: [StorefrontPaymentsController],
})
export class StorefrontPaymentsModule {}
