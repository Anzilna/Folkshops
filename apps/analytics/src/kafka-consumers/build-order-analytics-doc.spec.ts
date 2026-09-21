import type { BusinessEventEnvelope } from "@folkshops/events";
import { buildOrderAnalyticsDocId, buildOrderPaidDocument } from "./build-order-analytics-doc";

function envelope(overrides: Partial<BusinessEventEnvelope> = {}): BusinessEventEnvelope {
  return {
    eventId: "evt-1",
    eventType: "order.paid",
    tenantId: "tenant-1",
    aggregateType: "order",
    aggregateId: "order-1",
    occurredAt: "2026-09-19T10:00:00.000Z",
    version: 1,
    payload: {
      orderId: "order-1",
      paymentId: "pay-1",
      customerId: "cust-1",
      subtotalCents: 5000,
      currency: "aed",
      items: [{ productId: "prod-1", productName: "Coffee Mug", priceCents: 5000, quantity: 1 }],
    },
    ...overrides,
  };
}

describe("buildOrderAnalyticsDocId", () => {
  test("is deterministic and tenant-scoped — the entire idempotency/isolation mechanism", () => {
    expect(buildOrderAnalyticsDocId({ tenantId: "tenant-1", aggregateId: "order-1" })).toBe("order:tenant-1:order-1");
    // Two different tenants with the same aggregateId must never collide.
    expect(buildOrderAnalyticsDocId({ tenantId: "tenant-2", aggregateId: "order-1" })).toBe("order:tenant-2:order-1");
  });

  test("processing the same envelope twice yields the same id (redelivery is a no-op upsert, not a duplicate)", () => {
    const e = envelope();
    expect(buildOrderAnalyticsDocId(e)).toBe(buildOrderAnalyticsDocId(e));
  });
});

describe("buildOrderPaidDocument", () => {
  test("trusts the outbox's own payload as-is — never re-derives revenue/items from anything else", () => {
    const doc = buildOrderPaidDocument(envelope());

    expect(doc).toEqual({
      orderId: "order-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      eventType: "order.paid",
      status: "paid",
      subtotalCents: 5000,
      currency: "aed",
      items: [{ productId: "prod-1", productName: "Coffee Mug", priceCents: 5000, quantity: 1 }],
      occurredAt: "2026-09-19T10:00:00.000Z",
      lastEventId: "evt-1",
    });
  });
});
