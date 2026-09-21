import { Module } from "@nestjs/common";
import { StorefrontModule } from "../storefront/storefront.module";
import { CheckoutHandler } from "./commands/checkout.handler";
import { OrdersService } from "./orders.service";
import { GetCustomerOrderHandler } from "./queries/get-customer-order.handler";
import { ListCustomerOrdersHandler } from "./queries/list-customer-orders.handler";
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
  // CheckoutHandler/GetCustomerOrderHandler/ListCustomerOrdersHandler
  // registered ONLY here (customer) — see orders.module.ts's comment on
  // why the staff-side equivalents use distinct Query classes rather than
  // being shared.
  providers: [OrdersService, CheckoutHandler, GetCustomerOrderHandler, ListCustomerOrdersHandler],
})
export class StorefrontOrdersModule {}
