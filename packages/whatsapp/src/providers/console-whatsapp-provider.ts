import type { SendTemplateInput, WhatsAppProvider } from "./whatsapp-provider";

/** Dev stand-in until real Meta credentials are set — nothing leaves the machine. The message itself is already logged by createWhatsAppProvider()'s wrapper. */
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  async sendTemplate(input: SendTemplateInput): Promise<{ id: string }> {
    return { id: `console-${input.templateName}-${Date.now()}` };
  }
}
