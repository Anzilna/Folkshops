import { derivePaymentTransition, isPayableOrderStatus, PaymentsService } from "./payments.service";
import type { PaymentAccountsService } from "./payment-accounts.service";
import type { PaymentProvider } from "./payment-provider.interface";
import type { DbRouter } from "../database/db-router";

// withTenantContext normally opens a real transaction and runs a real
// `SET LOCAL app.tenant_id` via tx.execute(sql`...`) — irrelevant to what
// this suite is testing (the idempotency branching) and would require the
// fake db below to also fake .transaction()/.execute()/the sql tag for no
// benefit. Real tenant-context behavior is covered by every RLS test and
// by storefront-payments.integration.spec.ts against a real Postgres.
jest.mock("../database/tenant-context", () => ({
  withTenantContext: (db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) => fn(db),
}));

/**
 * Two layers of test here, deliberately split:
 *
 * 1. isPayableOrderStatus()/derivePaymentTransition() are pure — no DB, no
 *    provider — tested directly and exhaustively.
 * 2. initiatePayment()'s idempotency short-circuit (conflict -> no
 *    provider call) is tested against a minimal hand-rolled Drizzle chain
 *    mock, just enough to drive that one branch. A full realistic mock of
 *    Drizzle's fluent query builder (or the real unique-constraint
 *    behavior under genuine concurrency) is what
 *    storefront-payments.integration.spec.ts covers against a real
 *    Postgres instead — not duplicated here.
 */
describe("isPayableOrderStatus", () => {
  test.each(["pending", "awaiting_payment", "payment_failed"])("%s is payable", (status) => {
    expect(isPayableOrderStatus(status)).toBe(true);
  });

  test.each(["paid", "cancelled", "refunded", "partially_refunded"])("%s is not payable", (status) => {
    expect(isPayableOrderStatus(status)).toBe(false);
  });
});

describe("derivePaymentTransition", () => {
  test("captured -> payment captured, order paid", () => {
    expect(derivePaymentTransition("captured")).toEqual({ paymentStatus: "captured", orderStatus: "paid" });
  });

  test("failed -> payment failed, order payment_failed", () => {
    expect(derivePaymentTransition("failed")).toEqual({ paymentStatus: "failed", orderStatus: "payment_failed" });
  });

  test.each(["created", "authorized", "refunded"])("%s is not a terminal outcome — no transition", (status) => {
    expect(derivePaymentTransition(status)).toEqual({ paymentStatus: null, orderStatus: null });
  });
});

// A thenable chain object: awaiting it directly resolves to `result`
// (covers calls with no trailing .returning(), like the paymentOrderLookup
// insert), and every chain method just returns the same object so any
// call order Drizzle's fluent API might use keeps working.
function chain(result: unknown) {
  const obj: Record<string, unknown> = {
    from: () => obj,
    where: () => obj,
    limit: () => obj,
    values: () => obj,
    onConflictDoNothing: () => obj,
    set: () => obj,
    returning: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return obj;
}

describe("PaymentsService.initiatePayment — idempotency short-circuit", () => {
  const order = { id: "order-1", customerId: "cust-1", status: "pending", subtotalCents: 50000 };
  // Both tests here are about idempotency, not the payments-enabled gate
  // itself — that gate's own behavior (BadRequestException when the
  // store hasn't activated payments) is a separate, simpler unit test
  // below. Here the gate always passes, with a fixed linked account id.
  const liveAccount = { getForTenant: jest.fn().mockResolvedValue({ live: true, linkedAccountId: "acc_test123" }) } as unknown as PaymentAccountsService;
  const existingPayment = {
    id: "pay-1",
    tenantId: "tenant-1",
    orderId: "order-1",
    idempotencyKey: "key-1",
    amountCents: 50000,
    currency: "INR",
    provider: "razorpay",
    providerOrderId: "order_already_created",
    status: "created",
  };

  test("a retried idempotency key never calls the provider a second time", async () => {
    const createOrder = jest.fn();
    const gateway = { createOrder, getPublicKey: () => "rzp_test_key" } as unknown as PaymentProvider;

    const db = {
      // First select() call is the order lookup, second is the
      // conflict-path re-fetch by idempotency key — same fake db object
      // services both since neither test needs them to differ.
      select: jest.fn().mockReturnValueOnce(chain([order])).mockReturnValueOnce(chain([existingPayment])),
      // insert(payments)...onConflictDoNothing().returning() resolves to
      // [] (empty) — simulating a genuine unique-constraint conflict.
      insert: jest.fn().mockReturnValue(chain([])),
      update: jest.fn().mockReturnValue(chain([])),
    };
    const dbRouter = { write: (fn: (db: unknown) => unknown) => fn(db) } as unknown as DbRouter;

    const service = new PaymentsService(dbRouter, gateway, liveAccount);
    const result = await service.initiatePayment("tenant-1", "order-1", "cust-1", "key-1");

    expect(createOrder).not.toHaveBeenCalled();
    expect(result).toEqual({
      paymentId: "pay-1",
      provider: "razorpay",
      providerOrderId: "order_already_created",
      amountCents: 50000,
      currency: "INR",
      keyId: "rzp_test_key",
    });
  });

  test("a genuinely new idempotency key does call the provider once", async () => {
    const createOrder = jest.fn().mockResolvedValue({ providerOrderId: "order_new" });
    const gateway = { createOrder, getPublicKey: () => "rzp_test_key" } as unknown as PaymentProvider;

    const freshRow = { ...existingPayment, id: "pay-2", idempotencyKey: "key-2", providerOrderId: null };
    const updatedRow = { ...freshRow, providerOrderId: "order_new" };

    const db = {
      select: jest.fn().mockReturnValueOnce(chain([order])),
      insert: jest
        .fn()
        // payments insert -> a fresh row (not a conflict)
        .mockReturnValueOnce(chain([freshRow]))
        // paymentOrderLookup insert -> no .returning() called, result unused
        .mockReturnValueOnce(chain(undefined)),
      update: jest
        .fn()
        // payments update (sets providerOrderId)
        .mockReturnValueOnce(chain([updatedRow]))
        // orders update (awaiting_payment)
        .mockReturnValueOnce(chain(undefined)),
    };
    const dbRouter = { write: (fn: (db: unknown) => unknown) => fn(db) } as unknown as DbRouter;

    const service = new PaymentsService(dbRouter, gateway, liveAccount);
    const result = await service.initiatePayment("tenant-1", "order-1", "cust-1", "key-2");

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith({
      amountCents: 50000,
      currency: "INR",
      receipt: "pay-2",
      linkedAccountId: "acc_test123",
    });
    expect(result?.providerOrderId).toBe("order_new");
  });
});

describe("PaymentsService.initiatePayment — payments-enabled gate", () => {
  test("a store that hasn't activated payments rejects /pay before touching the DB", async () => {
    const createOrder = jest.fn();
    const gateway = { createOrder, getPublicKey: () => "rzp_test_key" } as unknown as PaymentProvider;
    const notLive = { getForTenant: jest.fn().mockResolvedValue(null) } as unknown as PaymentAccountsService;
    const dbRouter = { write: jest.fn() } as unknown as DbRouter;

    const service = new PaymentsService(dbRouter, gateway, notLive);

    await expect(service.initiatePayment("tenant-1", "order-1", "cust-1", "key-1")).rejects.toThrow(
      "This store hasn't set up payments yet",
    );
    expect(createOrder).not.toHaveBeenCalled();
    expect(dbRouter.write).not.toHaveBeenCalled();
  });
});
