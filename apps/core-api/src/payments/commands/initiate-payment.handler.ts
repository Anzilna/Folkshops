import { CommandHandler, ICommandHandler } from "@nestjs/cqrs";
import { PaymentsService } from "../payments.service";
import { InitiatePaymentCommand } from "./initiate-payment.command";

/** Thin — no duplicated business logic. Every real decision (idempotency,
 * the payments-enabled gate, the Stripe call, the transaction) still
 * lives entirely inside PaymentsService.initiatePayment(). */
@CommandHandler(InitiatePaymentCommand)
export class InitiatePaymentHandler implements ICommandHandler<InitiatePaymentCommand> {
  constructor(private readonly payments: PaymentsService) {}

  execute(command: InitiatePaymentCommand) {
    return this.payments.initiatePayment(command.tenantId, command.orderId, command.customerId, command.idempotencyKey, command.returnUrl);
  }
}
