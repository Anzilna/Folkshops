/**
 * Every WhatsApp message a business starts must use a template that Meta
 * has pre-approved — the text lives in Meta's WhatsApp Manager, and at send
 * time we only pass the template's name and its {{n}} values. So unlike
 * @folkshops/emails there's nothing to render here: each entry records the
 * exact body to register with Meta (`body`, also used for the console log)
 * and how to turn our props into its ordered parameters.
 *
 * To go live, create each template below in WhatsApp Manager with the SAME
 * name, category and language, and paste `body` in verbatim. A name/param
 * count mismatch is rejected by Meta at send time (error 132000/132001).
 */

export interface OrderConfirmedProps {
  customerName: string | null;
  storeName: string;
  orderNumber: string;
  total: string;
  orderUrl: string;
}

export interface PaymentNotCompletedProps {
  customerName: string | null;
  storeName: string;
  orderNumber: string;
  /** The storefront order page — it shows "Pay now" for a payment_failed order (PAYABLE_STATUSES there). */
  orderUrl: string;
}

export interface WhatsAppTemplateProps {
  order_confirmed: OrderConfirmedProps;
  payment_not_completed: PaymentNotCompletedProps;
}

export type WhatsAppTemplateName = keyof WhatsAppTemplateProps;

interface TemplateDefinition<P> {
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  body: string;
  params: (props: P) => string[];
}

const firstNameOrThere = (name: string | null) => name?.trim().split(/\s+/)[0] || "there";

export const WHATSAPP_TEMPLATES: { [K in WhatsAppTemplateName]: TemplateDefinition<WhatsAppTemplateProps[K]> } = {
  order_confirmed: {
    category: "UTILITY",
    body: "Hi {{1}}, thanks for shopping at {{2}}! Your order {{3}} is confirmed and paid. Total: {{4}}. View your order: {{5}}",
    params: (p) => [firstNameOrThere(p.customerName), p.storeName, p.orderNumber, p.total, p.orderUrl],
  },
  payment_not_completed: {
    category: "UTILITY",
    body: "Hi {{1}}, the payment for your order {{2}} at {{3}} didn't go through. Your order is saved — you can complete payment here: {{4}}",
    params: (p) => [firstNameOrThere(p.customerName), p.orderNumber, p.storeName, p.orderUrl],
  },
};

/** The message as the customer will read it — for logs and the console provider. */
export function previewTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}
