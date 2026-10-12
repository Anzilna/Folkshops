import type { WhatsAppTemplateName, WhatsAppTemplateProps } from "@folkshops/whatsapp";
import { Queue } from "bullmq";
import { redis } from "./redis";

export interface WhatsAppJobData<K extends WhatsAppTemplateName = WhatsAppTemplateName> {
  to: string;
  template: K;
  props: WhatsAppTemplateProps[K];
}

export const WHATSAPP_QUEUE_NAME = "whatsapp";

/** Own queue, same reasoning as email-queue.ts: a failing send retries only the send, never the outbox handler's DB work. */
export const whatsappQueue = new Queue<WhatsAppJobData>(WHATSAPP_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});

/**
 * `idempotencyKey` is the BullMQ jobId — the only dedupe layer here, since
 * Meta's API has no idempotency key of its own. Same `-`-joined shape as
 * email keys (BullMQ rejects `:` in ids).
 */
export async function enqueueWhatsApp<K extends WhatsAppTemplateName>(idempotencyKey: string, data: WhatsAppJobData<K>): Promise<void> {
  await whatsappQueue.add(data.template, data, { jobId: idempotencyKey });
}
