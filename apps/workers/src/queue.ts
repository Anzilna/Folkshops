import { Queue } from "bullmq";
import { redis } from "./redis";

/** Job data — always just enough to re-look-up the outbox row, never a
 * copy of business data (same "thin pointer" restraint as the outbox
 * table itself, see outbox-events.ts's schema comment). */
export interface OutboxJobData {
  outboxId: string;
  tenantId: string;
  payload: Record<string, unknown>;
}

export const OUTBOX_QUEUE_NAME = "outbox";

export const outboxQueue = new Queue<OutboxJobData>(OUTBOX_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // 3 attempts with exponential backoff before a job is left failed —
    // visible in the outbox row itself too (attempts/lastError, see
    // relay.ts), not just BullMQ's own internal state, since the outbox
    // row is the actual source of truth for "did this happen."
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    // Keep a bounded window of finished jobs for visibility/debugging
    // without letting Redis grow unbounded.
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});
