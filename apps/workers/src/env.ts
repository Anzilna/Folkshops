import { config } from "dotenv";
import path from "node:path";

// Own .env, same convention as every other app in the monorepo (core-api,
// merchant-admin, ...) — not the repo root's.
config({ path: path.resolve(__dirname, "..", ".env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required — see .env.example`);
  return value;
}

export const env = {
  databasePrimaryUrl: required("DATABASE_PRIMARY_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  outboxPollIntervalMs: Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 3000),
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  nodeEnv: process.env.NODE_ENV,
  // Optional outside production — unset means ConsoleEmailProvider (see
  // @folkshops/emails' createEmailProvider), same posture as core-api's
  // ConsoleOtpProvider.
  resendApiKey: process.env.RESEND_API_KEY || undefined,
  emailFrom: process.env.EMAIL_FROM ?? "Folkshops <onboarding@resend.dev>",
  // Where links inside emails point. {slug} is replaced per store — the
  // storefront resolves its tenant from the subdomain (see storefront's
  // resolveStoreSlug()), so a store's public URL is always slug-shaped.
  merchantAdminUrl: process.env.MERCHANT_ADMIN_URL ?? "http://localhost:3001",
  storefrontUrlTemplate: process.env.STOREFRONT_URL_TEMPLATE ?? "http://{slug}.localhost:3000",
  // Customer WhatsApp updates (@folkshops/whatsapp). Both unset = messages
  // are console.logged only (they're logged either way).
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || undefined,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || undefined,
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? "v23.0",
  // Must match the language each template was approved in, in WhatsApp Manager.
  whatsappTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en",
};
