import { ConsoleWhatsAppProvider } from "./console-whatsapp-provider";
import { MetaCloudWhatsAppProvider } from "./meta-cloud-whatsapp-provider";
import type { SendTemplateInput, WhatsAppProvider } from "./whatsapp-provider";

export interface WhatsAppConfig {
  accessToken?: string;
  phoneNumberId?: string;
  apiVersion: string;
}

/**
 * Meta when both credentials are set, console otherwise. Unlike email,
 * missing credentials in production are a warning, not a boot failure:
 * WhatsApp is an opt-in extra channel, and refusing to start would take
 * the email + notification workers down with it.
 *
 * Either way every message is console.logged — with the real provider
 * that gives a local record of what was sent (and Meta's message id) next
 * to the job logs.
 */
export function createWhatsAppProvider(config: WhatsAppConfig): { provider: WhatsAppProvider; mode: "meta" | "console" } {
  const configured = Boolean(config.accessToken && config.phoneNumberId);
  if (!configured) {
    console.warn("[whatsapp] WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set — messages will be logged, not sent.");
  }
  const inner: WhatsAppProvider = configured
    ? new MetaCloudWhatsAppProvider({ accessToken: config.accessToken!, phoneNumberId: config.phoneNumberId!, apiVersion: config.apiVersion })
    : new ConsoleWhatsAppProvider();
  const mode = configured ? "meta" : "console";

  return {
    mode,
    provider: {
      async sendTemplate(input: SendTemplateInput) {
        console.log(`[whatsapp:${mode}] to=${input.to} template=${input.templateName} (${input.languageCode})\n${input.preview}\n`);
        const result = await inner.sendTemplate(input);
        console.log(`[whatsapp:${mode}] sent ${input.templateName} to ${input.to} — id=${result.id}`);
        return result;
      },
    },
  };
}
