import type { RenderedEmail } from "../render";

export interface SendEmailInput extends RenderedEmail {
  to: string;
  /**
   * Stable per logical email (e.g. `${outboxId}-new-order-${userId}`), so a
   * retried job can never deliver the same email twice — passed straight
   * through as the provider's own idempotency key where it has one.
   */
  idempotencyKey: string;
}

/**
 * Same swap-seam shape as core-api's OtpProvider/PaymentProvider: one
 * interface, callers never know which vendor is behind it. A second vendor
 * (SES, Postmark) is a new file in this directory, nothing else changes.
 */
export interface EmailProvider {
  send(input: SendEmailInput): Promise<{ id: string }>;
}
