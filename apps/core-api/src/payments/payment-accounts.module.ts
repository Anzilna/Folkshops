import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PaymentAccountsController } from "./payment-accounts.controller";
import { PaymentsCoreModule } from "./payments-core.module";

// Staff-only, so only AuthModule — never StorefrontModule alongside it,
// same JwtService-collision reasoning as OrdersModule (bug #7).
// PaymentAccountsService itself lives in PaymentsCoreModule (see that
// module's comment) — this module just wires the staff-guarded controller
// to it.
@Module({
  imports: [AuthModule, PaymentsCoreModule],
  controllers: [PaymentAccountsController],
})
export class PaymentAccountsModule {}
