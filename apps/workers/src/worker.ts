import { Worker, type Job } from "bullmq";
import { pool } from "./db";
import { handlePaymentsActivated, handleSubscriptionEvent } from "./handlers/billing-events";
import { handleMerchantRegistered } from "./handlers/merchant-registered";
import { handleOrderPaid } from "./handlers/order-paid";
import { handlePasswordResetRequested } from "./handlers/password-reset-requested";
import { handlePaymentFailed } from "./handlers/payment-failed";
import { OUTBOX_QUEUE_NAME, type OutboxJobData } from "./queue";
import { redis } from "./redis";

type OutboxHandler = (tenantId: string, payload: Record<string, unknown>, outboxId: string, eventType: string) => Promise<void>;

const HANDLERS: Record<string, OutboxHandler> = {
  "order.paid": handleOrderPaid,
  "payment.failed": handlePaymentFailed,
  "merchant.registered": handleMerchantRegistered,
  "staff.password_reset_requested": handlePasswordResetRequested,
  "subscription.activated": handleSubscriptionEvent,
  "subscription.past_due": handleSubscriptionEvent,
  "subscription.canceled": handleSubscriptionEvent,
  "payments.activated": handlePaymentsActivated,
};

async function markProcessed(outboxId: string): Promise<void> {
  await pool.query("UPDATE outbox_events SET processed_at = now() WHERE id = $1", [outboxId]);
}

async function recordFailure(outboxId: string, message: string): Promise<void> {
  await pool.query("UPDATE outbox_events SET last_error = $2 WHERE id = $1", [outboxId, message.slice(0, 2000)]);
}

export function startWorker(): Worker<OutboxJobData> {
  const worker = new Worker<OutboxJobData>(
    OUTBOX_QUEUE_NAME,
    async (job: Job<OutboxJobData>) => {
      const handler = HANDLERS[job.name];
      if (!handler) {
        // An event type the relay dispatched but no handler exists for —
        // a real bug (a new outbox eventType shipped without its
        // handlers.ts entry), not a transient failure, so retrying
        // wouldn't help. Logged loudly rather than silently swallowed.
        throw new Error(`No handler registered for outbox event type "${job.name}"`);
      }
      await handler(job.data.tenantId, job.data.payload, job.data.outboxId, job.name);
    },
    { connection: redis, concurrency: 5 },
  );

  worker.on("completed", (job) => {
    void markProcessed(job.data.outboxId);
  });

  worker.on("failed", (job, err) => {
    if (!job) return;
    console.error(`[worker] job ${job.id} (${job.name}) failed (attempt ${job.attemptsMade}): ${err.message}`);
    void recordFailure(job.data.outboxId, err.message);
  });

  return worker;
}
