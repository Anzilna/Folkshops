import { EVENT_TYPE_TOPIC, type BusinessEventEnvelope } from "@folkshops/events";
import { ensureProducerConnected, kafkaProducer } from "./kafka";

export interface OutboxRowForPublish {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/**
 * The second, independent sink the relay feeds per row (alongside the
 * existing, unchanged BullMQ enqueue) — see docs/decisions/0009. Returns
 * normally (does nothing) for an eventType with no topic mapping yet (e.g.
 * a future cart.abandoned) rather than throwing, since that's an
 * expected, documented gap, not a bug.
 */
export async function publishBusinessEvent(row: OutboxRowForPublish): Promise<void> {
  const topic = EVENT_TYPE_TOPIC[row.event_type];
  if (!topic) return;

  const envelope: BusinessEventEnvelope = {
    eventId: row.id,
    eventType: row.event_type,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    occurredAt: row.created_at.toISOString(),
    version: 1,
    payload: row.payload,
  };

  await ensureProducerConnected();
  // Keyed by tenantId — gives per-tenant ordering within a partition, which
  // is all consumers actually rely on (they upsert by aggregateId
  // regardless of intra-tenant order, see apps/analytics' consumers).
  await kafkaProducer.send({
    topic,
    messages: [{ key: envelope.tenantId, value: JSON.stringify(envelope) }],
  });
}
