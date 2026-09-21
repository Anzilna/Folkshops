/**
 * Stable envelope for every business event published from the transactional
 * outbox (`outbox_events`, apps/core-api) to Kafka via apps/workers' relay.
 * Never reused for CDC messages — see DebeziumChangeEvent in ./cdc.ts and
 * docs/decisions/0009-analytics-outbox-cdc-kafka.md for why the two must
 * stay structurally separate.
 */
export interface BusinessEventEnvelope<TPayload = Record<string, unknown>> {
  /** outbox_events.id — also the natural Kafka message key's source and the
   * idempotency anchor a consumer can log alongside its own doc id. */
  eventId: string;
  /** e.g. "order.paid", "payment.failed". See packages/events/src/topics.ts's
   * EVENT_TYPE_TOPIC for the full set that's actually wired to a topic. */
  eventType: string;
  tenantId: string;
  /** e.g. "order" — what aggregateId refers to. */
  aggregateType: string;
  /** e.g. orders.id */
  aggregateId: string;
  /** ISO 8601, outbox_events.created_at */
  occurredAt: string;
  version: 1;
  payload: TPayload;
}
