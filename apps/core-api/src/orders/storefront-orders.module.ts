import { Module } from "@nestjs/common";
import { StorefrontModule } from "../storefront/storefront.module";
import { OrdersService } from "./orders.service";
import { StorefrontOrdersController } from "./storefront-orders.controller";

// Customer-facing half of orders — split from OrdersModule specifically to
// avoid importing both AuthModule and StorefrontModule into one module.
// See OrdersModule's comment for the JwtService token collision that
// caused. OrdersService is provided again here (a second instance,
// stateless — it only wraps the globally-available DbRouter) rather than
// exported from OrdersModule, to keep this module's only dependency being
// StorefrontModule.
@Module({
  imports: [StorefrontModule],
  controllers: [StorefrontOrdersController],
  providers: [OrdersService],
})
export class StorefrontOrdersModule {}
