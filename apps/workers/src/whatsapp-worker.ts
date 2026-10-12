import { createWhatsAppProvider, previewTemplate, WHATSAPP_TEMPLATES } from "@folkshops/whatsapp";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { env } from "./env";
import { redis } from "./redis";
import { WHATSAPP_QUEUE_NAME, type WhatsAppJobData } from "./whatsapp-queue";

/**
 * Meta error codes where retrying can never help — fail the job at once
 * instead of burning 5 attempts. 131026: recipient can't receive (not on
 * WhatsApp, old app, …). 132000/132001: param count mismatch / template
 * not found (i.e. WhatsApp Manager doesn't match templates.ts). 100:
 * invalid parameter.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const WHATSAPP_NON_RETRYABLE_CODES = new Set([100, 131026, 132000, 132001]);

export function startWhatsAppWorker(): Worker<WhatsAppJobData> {
  const { provider } = createWhatsAppProvider({
    accessToken: env.whatsappAccessToken,
    phoneNumberId: env.whatsappPhoneNumberId,
    apiVersion: env.whatsappApiVersion,
  });

  const worker = new Worker<WhatsAppJobData>(
    WHATSAPP_QUEUE_NAME,
    async (job: Job<WhatsAppJobData>) => {
      const definition = WHATSAPP_TEMPLATES[job.data.template];
      if (!definition) throw new UnrecoverableError(`Unknown WhatsApp template "${job.data.template}"`);
      // The props/template pairing is enforced by enqueueWhatsApp()'s types; the cast only bridges the map's per-key union.
      const params = (definition.params as (p: unknown) => string[])(job.data.props);
      try {
        const { id } = await provider.sendTemplate({
          to: job.data.to,
          templateName: job.data.template,
          languageCode: env.whatsappTemplateLanguage,
          params,
          preview: previewTemplate(definition.body, params),
        });
        return { providerMessageId: id };
      } catch (err) {
        const code = (err as { metaCode?: number }).metaCode;
        if (code !== undefined && WHATSAPP_NON_RETRYABLE_CODES.has(code)) throw new UnrecoverableError((err as Error).message);
        throw err;
      }
    },
    { connection: redis, concurrency: 5 },
  );

  worker.on("failed", (job, err) => {
    if (!job) return;
    console.error(`[whatsapp] job ${job.id} (${job.name} -> ${job.data.to}) failed (attempt ${job.attemptsMade}): ${err.message}`);
  });

  return worker;
}
