import { CommandHandler, ICommandHandler } from "@nestjs/cqrs";
import { PaymentsService } from "../payments.service";
import { ProcessPaymentWebhookCommand } from "./process-payment-webhook.command";

@CommandHandler(ProcessPaymentWebhookCommand)
export class ProcessPaymentWebhookHandler implements ICommandHandler<ProcessPaymentWebhookCommand> {
  constructor(private readonly payments: PaymentsService) {}

  execute(command: ProcessPaymentWebhookCommand) {
    return this.payments.handleWebhookEvent(command.event);
  }
}
