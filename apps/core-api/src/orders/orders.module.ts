import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

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
  providers: [OrdersService],
})
export class OrdersModule {}
