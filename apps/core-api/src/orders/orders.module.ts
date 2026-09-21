import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { GetOrderHandler } from "./queries/get-order.handler";
import { ListOrdersHandler } from "./queries/list-orders.handler";

// Staff-facing only — deliberately does NOT also import StorefrontModule.
// A module importing both AuthModule and StorefrontModule would pull in
// two differently-configured JwtModule registrations that both provide
// the same @nestjs/jwt JwtService token; Nest resolves that silently to
// one of them rather than erroring, so every guard in the module ends up
// using whichever JwtService won, not necessarily the one each guard
// actually needs. Caught by actually calling /storefront/orders/checkout
// and getting "invalid signature" — see StorefrontOrdersModule for the
// customer-facing half this was split out of.
@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  // GetOrderHandler/ListOrdersHandler registered ONLY here (staff) — the
  // customer-side equivalents (GetCustomerOrderHandler/
  // ListCustomerOrdersHandler) live in StorefrontOrdersModule, using
  // distinct Query classes so the two never collide in CommandBus/
  // QueryBus's shared, class-keyed handler map. See
  // docs/decisions/0010-partial-cqrs-migration.md.
  providers: [OrdersService, GetOrderHandler, ListOrdersHandler],
})
export class OrdersModule {}
