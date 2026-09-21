import { CommandHandler, ICommandHandler } from "@nestjs/cqrs";
import { OrdersService } from "../orders.service";
import { CheckoutCommand } from "./checkout.command";

/** Registered ONLY in StorefrontOrdersModule — checkout is a customer
 * action, there is no staff-side equivalent. Thin: OrdersService.checkout()
 * still owns the whole cart-snapshot write transaction, unchanged. */
@CommandHandler(CheckoutCommand)
export class CheckoutHandler implements ICommandHandler<CheckoutCommand> {
  constructor(private readonly orders: OrdersService) {}

  execute(command: CheckoutCommand) {
    return this.orders.checkout(command.tenantId, command.customerId);
  }
}
