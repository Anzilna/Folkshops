import type { SendTemplateInput, WhatsAppProvider } from "./whatsapp-provider";

export interface MetaCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
}

/**
 * Meta's own WhatsApp Cloud API, called directly — no BSP in between, so no
 * per-message markup on top of Meta's price. One HTTP call per message:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 *
 * Meta has no idempotency-key header, so exactly-once is the caller's job:
 * apps/workers keys each job by outbox row (BullMQ jobId) and never
 * re-enqueues a completed one.
 */
export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly config: MetaCloudConfig) {}

  async sendTemplate(input: SendTemplateInput): Promise<{ id: string }> {
    const res = await fetch(`https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        // Cloud API wants digits only, no leading "+".
        to: input.to.replace(/[^\d]/g, ""),
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          components: input.params.length
            ? [{ type: "body", parameters: input.params.map((text) => ({ type: "text", text })) }]
            : [],
        },
      }),
    });

    const body = (await res.json().catch(() => null)) as { messages?: { id: string }[]; error?: { message?: string; code?: number } } | null;
    if (!res.ok || !body?.messages?.[0]?.id) {
      // Thrown so the queue retries — but see WHATSAPP_NON_RETRYABLE_CODES
      // in apps/workers for errors (bad template, invalid number) where a
      // retry can never succeed.
      const err = new Error(`WhatsApp send failed (${res.status}): ${body?.error?.message ?? "no message id returned"}`) as Error & { metaCode?: number };
      err.metaCode = body?.error?.code;
      throw err;
    }
    return { id: body.messages[0].id };
  }
}
