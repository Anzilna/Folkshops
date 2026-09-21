/** Delegates to PaymentsService.initiatePayment() — idempotency (real DB
 * unique constraint on (tenantId, idempotencyKey), checked BEFORE any
 * Stripe call), the payments-enabled gate, and the write transaction all
 * stay exactly as they are. */
export class InitiatePaymentCommand {
  constructor(
    public readonly tenantId: string,
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly idempotencyKey: string,
    public readonly returnUrl: string,
  ) {}
}
