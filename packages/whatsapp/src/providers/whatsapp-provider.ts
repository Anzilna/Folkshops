export interface SendTemplateInput {
  /** E.164, e.g. "+971501234567" — the format customers.phone is stored in. */
  to: string;
  templateName: string;
  languageCode: string;
  params: string[];
  /** Rendered text, for logging only — Meta renders the real message from its own copy of the template. */
  preview: string;
}

/**
 * Same swap-seam as EmailProvider/OtpProvider. A BSP (Twilio, 360dialog,
 * Gupshup) would be one more implementation of this; nothing else changes.
 */
export interface WhatsAppProvider {
  sendTemplate(input: SendTemplateInput): Promise<{ id: string }>;
}
