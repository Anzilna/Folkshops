import { Resend } from "resend";
import type { EmailProvider, SendEmailInput } from "./email-provider";

export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(input: SendEmailInput): Promise<{ id: string }> {
    const { data, error } = await this.client.emails.send(
      { from: this.from, to: input.to, subject: input.subject, html: input.html, text: input.text },
      { idempotencyKey: input.idempotencyKey },
    );
    // The Resend SDK reports API failures as a returned `error`, not a
    // thrown one — rethrow so the caller's queue sees a failed job and
    // retries it, instead of silently marking an unsent email as done.
    if (error || !data) throw new Error(`Resend send failed: ${error?.name ?? "unknown"} — ${error?.message ?? "no data returned"}`);
    return { id: data.id };
  }
}
