import { InitiatePaymentHandler } from "./commands/initiate-payment.handler";
import { ProcessPaymentWebhookHandler } from "./commands/process-payment-webhook.handler";
import { InitiatePaymentCommand } from "./commands/initiate-payment.command";
import { ProcessPaymentWebhookCommand } from "./commands/process-payment-webhook.command";
import type { PaymentsService } from "./payments.service";

describe("payments command handlers", () => {
  function fakeService() {
    return {
      initiatePayment: jest.fn().mockResolvedValue({ paymentId: "pay-1", url: "https://checkout.stripe.com/x" }),
      handleWebhookEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as PaymentsService;
  }

  test("InitiatePaymentHandler delegates to PaymentsService.initiatePayment(...) with every field, in order", async () => {
    const payments = fakeService();
    const handler = new InitiatePaymentHandler(payments);

    const result = await handler.execute(new InitiatePaymentCommand("tenant-1", "order-1", "cust-1", "key-1", "https://store.test/orders/order-1"));

    expect(payments.initiatePayment).toHaveBeenCalledWith("tenant-1", "order-1", "cust-1", "key-1", "https://store.test/orders/order-1");
    expect(result).toEqual({ paymentId: "pay-1", url: "https://checkout.stripe.com/x" });
  });

  test("ProcessPaymentWebhookHandler delegates to PaymentsService.handleWebhookEvent(event)", async () => {
    const payments = fakeService();
    const handler = new ProcessPaymentWebhookHandler(payments);
    const event = { id: "evt_1", type: "checkout.session.completed" } as never;

    await handler.execute(new ProcessPaymentWebhookCommand(event));

    expect(payments.handleWebhookEvent).toHaveBeenCalledWith(event);
  });
});
