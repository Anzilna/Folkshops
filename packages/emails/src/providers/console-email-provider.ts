import type { EmailProvider, SendEmailInput } from "./email-provider";

/**
 * Dev/CI stand-in, same role as ConsoleOtpProvider: logs what would have
 * been sent instead of calling a real vendor. Prints the plain-text body so
 * links (dashboard, order page) are clickable straight from the terminal;
 * `pnpm --filter @folkshops/emails dev` is where to look at the actual HTML.
 */
export class ConsoleEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<{ id: string }> {
    console.log(`[email:console] to=${input.to} subject="${input.subject}" key=${input.idempotencyKey}\n${input.text}\n`);
    return { id: `console-${input.idempotencyKey}` };
  }
}
