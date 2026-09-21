/** Named Checkout, not CreateOrder — checkout() is the codebase's own
 * real method/vocabulary (OrdersService.checkout()) for "snapshot the
 * cart into an order, in one write transaction, then clear the cart."
 * Inventing "create order" terminology the code doesn't otherwise use
 * would be confusing, not clarifying. */
export class CheckoutCommand {
  constructor(
    public readonly tenantId: string,
    public readonly customerId: string,
  ) {}
}
