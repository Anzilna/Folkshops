import type { BusinessEventEnvelope } from "@folkshops/events";

export interface OrderPaidPayload {
  orderId: string;
  paymentId: string;
  customerId: string | null;
  subtotalCents: number | null;
  currency: string;
  items: { productId: string; productName: string; priceCents: number; quantity: number }[];
}

/**
 * Pure — no Kafka, no Elasticsearch client — so it's unit-testable
 * without mocking either, same split as core-api's
 * derivePaymentTransition(). Trusts envelope.payload as-is (the outbox's
 * own explicit shape), never re-derives revenue/line-items from a CDC
 * row — see docs/decisions/0009.
 */
export function buildOrderAnalyticsDocId(envelope: Pick<BusinessEventEnvelope, "tenantId" | "aggregateId">): string {
  return `order:${envelope.tenantId}:${envelope.aggregateId}`;
}

export function buildOrderPaidDocument(envelope: BusinessEventEnvelope): Record<string, unknown> {
  const payload = envelope.payload as unknown as OrderPaidPayload;

  return {
    orderId: envelope.aggregateId,
    tenantId: envelope.tenantId,
    customerId: payload.customerId,
    eventType: envelope.eventType,
    status: "paid",
    subtotalCents: payload.subtotalCents,
    currency: payload.currency,
    items: payload.items,
    occurredAt: envelope.occurredAt,
    lastEventId: envelope.eventId,
  };
}
