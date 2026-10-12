import { createEmailProvider, renderEmail } from "@folkshops/emails";
import { Worker, type Job } from "bullmq";
import { EMAIL_QUEUE_NAME, type EmailJobData } from "./email-queue";
import { env } from "./env";
import { redis } from "./redis";

export function startEmailWorker(): Worker<EmailJobData> {
  // Built at boot, not per job — in production a missing RESEND_API_KEY
  // fails the whole process on startup rather than on the first order.
  const provider = createEmailProvider({ resendApiKey: env.resendApiKey, from: env.emailFrom, nodeEnv: env.nodeEnv });

  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
      const rendered = await renderEmail(job.data.template, job.data.props);
      const { id } = await provider.send({ ...rendered, to: job.data.to, idempotencyKey: job.id! });
      return { providerMessageId: id };
    },
    // Low concurrency on purpose — Resend's default rate limit is a few
    // requests/second; bursting past it just converts into retries.
    { connection: redis, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    if (!job) return;
    console.error(`[email] job ${job.id} (${job.name} -> ${job.data.to}) failed (attempt ${job.attemptsMade}): ${err.message}`);
  });

  return worker;
}
