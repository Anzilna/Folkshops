import { Module } from "@nestjs/common";
import { InitiatePaymentHandler } from "./commands/initiate-payment.handler";
import { ProcessPaymentWebhookHandler } from "./commands/process-payment-webhook.handler";
import { StripeProvider } from "./providers/stripe.provider";
import { PAYMENT_GATEWAY } from "./payment-provider.interface";
import { PaymentAccountsService } from "./payment-accounts.service";
import { PaymentsService } from "./payments.service";

/**
 * Shared (imported by StorefrontPaymentsModule, PaymentsWebhookModule, and
 * PaymentAccountsModule) rather than duplicated the way OrdersService is
 * between OrdersModule/StorefrontOrdersModule. That duplication exists
 * specifically to avoid two different JwtModule registrations colliding
 * (CLAUDE.md bug #7) — this module never touches JwtModule/AuthModule/
 * StorefrontModule at all, only DbRouter (global, from DatabaseModule)
 * and ConfigService, so that specific collision risk doesn't apply here.
 * PaymentAccountsService lives here rather than alongside AuthModule in
 * PaymentAccountsModule for exactly this reason: StorefrontPaymentsModule
 * needs isPaymentsEnabled() to gate /pay, and pairing that service with
 * AuthModule would force StorefrontPaymentsModule to import AuthModule
 * transitively — recreating bug #7's exact collision, just one level
 * indirect, against a module (StorefrontModule) it already imports for
 * its own (customer) JwtModule.
 */
@Module({
  // InitiatePaymentHandler/ProcessPaymentWebhookHandler registered once
  // here (not duplicated per consuming module, unlike OrdersService) —
  // this module already imports neither AuthModule nor StorefrontModule,
  // so there's no bug-#7-class collision risk to avoid by splitting them.
  // CommandBus itself comes from CqrsModule (registered globally in
  // AppModule) — no need to import CqrsModule here too. See
  // docs/decisions/0010-partial-cqrs-migration.md.
  providers: [
    PaymentsService,
    PaymentAccountsService,
    { provide: PAYMENT_GATEWAY, useClass: StripeProvider },
    InitiatePaymentHandler,
    ProcessPaymentWebhookHandler,
  ],
  // PAYMENT_GATEWAY exported alongside the services, not just them —
  // StripeSignatureGuard (in PaymentsWebhookModule) injects
  // PAYMENT_GATEWAY directly, not through a service, so it needs the
  // binding visible too or Nest can't resolve it at boot
  // (UnknownDependenciesException) — caught by actually booting the app,
  // not by any type check, same class of gap as CLAUDE.md bug #3.
  exports: [PaymentsService, PaymentAccountsService, PAYMENT_GATEWAY],
})
export class PaymentsCoreModule {}
