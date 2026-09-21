import { pool } from "./db";
import { env } from "./env";
import { publishBusinessEvent, type OutboxRowForPublish } from "./publish-business-event";
import { outboxQueue } from "./queue";

type OutboxRow = OutboxRowForPublish;

/**
 * The relay half of the pattern — everything durable already happened the
 * moment core-api committed the outbox row (see outbox-events.ts's schema
 * comment); this just notices it and hands it to BullMQ for actual
 * processing (retries/backoff/concurrency, none of which this file
 * re-implements). `dispatched_at < now() - interval '1 minute'` is the
 * self-healing half: if a row got dispatched but the process crashed
 * before BullMQ ever ran it (or Redis dropped it), the next poll picks it
 * up again rather than it staying stuck forever — `attempts` lets you
 * tell "still working on it" apart from "keeps failing" by eye.
 *
 * Since docs/decisions/0009, each row also gets an independent second
 * attempt at a Kafka publish (`kafka_published_at`) — the WHERE clause ORs
 * across BOTH sinks' completion columns, each still gated by the same
 * staleness window, so a row that succeeds on one sink but fails on the
 * other keeps getting re-picked-up for the sink that's still incomplete,
 * without ever re-enqueuing a BullMQ job (or re-publishing to Kafka) that
 * already succeeded.
 */
async function pollOnce(): Promise<void> {
  const { rows } = await pool.query<OutboxRow>(
    `SELECT id, tenant_id, event_type, aggregate_type, aggregate_id, payload, created_at
     FROM outbox_events
     WHERE (
       (processed_at IS NULL AND (dispatched_at IS NULL OR dispatched_at < now() - interval '1 minute'))
       OR
       (kafka_published_at IS NULL AND (dispatched_at IS NULL OR dispatched_at < now() - interval '1 minute'))
     )
     ORDER BY created_at
     LIMIT 50`,
  );

  for (const row of rows) {
    await pool.query("UPDATE outbox_events SET dispatched_at = now(), attempts = attempts + 1 WHERE id = $1", [row.id]);
    await outboxQueue.add(row.event_type, { outboxId: row.id, tenantId: row.tenant_id, payload: row.payload });

    // Independent of the BullMQ enqueue above — never blocks/fails it.
    // Kafka being down must not regress the existing notification path.
    try {
      await publishBusinessEvent(row);
      await pool.query("UPDATE outbox_events SET kafka_published_at = now() WHERE id = $1", [row.id]);
    } catch (err) {
      console.error(`[relay] Kafka publish failed for outbox row ${row.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

export function startRelay(): NodeJS.Timeout {
  const timer = setInterval(() => {
    pollOnce().catch((err) => console.error("[relay] poll failed:", err instanceof Error ? err.message : err));
  }, env.outboxPollIntervalMs);
  // Don't let this interval alone keep the process alive if everything
  // else has already shut down — matches the graceful-shutdown posture in
  // index.ts.
  timer.unref();
  return timer;
}
