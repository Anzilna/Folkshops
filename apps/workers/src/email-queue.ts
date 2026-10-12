import type { EmailTemplateName, EmailTemplateProps } from "@folkshops/emails";
import { Queue } from "bullmq";
import { redis } from "./redis";

export interface EmailJobData<K extends EmailTemplateName = EmailTemplateName> {
  to: string;
  template: K;
  /** Plain JSON only — rendered to HTML in email-worker.ts, never before enqueueing, so a template fix applies to jobs still waiting in the queue. */
  props: EmailTemplateProps[K];
}

export const EMAIL_QUEUE_NAME = "email";

/**
 * Its own queue rather than sending inline from an outbox handler: an
 * outbox handler also does DB work (e.g. order.paid's bell notification),
 * and a flaky email vendor retrying that whole handler would redo the DB
 * work too. Here a failed send retries only the send.
 */
export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // More patient than the outbox queue — vendor outages/rate limits are
    // the common failure here, and those clear up on a minutes scale.
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});

/**
 * `idempotencyKey` doubles as the BullMQ jobId (a second add() with the
 * same id is a no-op while the first is still retained) AND the vendor's
 * idempotency key (see ResendEmailProvider) — so an outbox handler that
 * gets retried after it already enqueued can never produce a second email.
 * BullMQ rejects `:` in custom ids, hence `-`-joined keys everywhere.
 */
export async function enqueueEmail<K extends EmailTemplateName>(idempotencyKey: string, data: EmailJobData<K>): Promise<void> {
  await emailQueue.add(data.template, data, { jobId: idempotencyKey });
}
