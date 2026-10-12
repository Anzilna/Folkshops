export {
  WHATSAPP_TEMPLATES,
  previewTemplate,
  type OrderConfirmedProps,
  type PaymentNotCompletedProps,
  type WhatsAppTemplateName,
  type WhatsAppTemplateProps,
} from "./templates";
export type { SendTemplateInput, WhatsAppProvider } from "./providers/whatsapp-provider";
export { createWhatsAppProvider, type WhatsAppConfig } from "./providers/create-whatsapp-provider";
