import { ConsoleEmailProvider } from "./console-email-provider";
import type { EmailProvider } from "./email-provider";
import { ResendEmailProvider } from "./resend-email-provider";

/**
 * Resend whenever RESEND_API_KEY is set, console otherwise — so local dev
 * and CI need no account at all. Production refuses to silently fall back:
 * a missing key there would mean every email is quietly dropped into a log
 * nobody reads, which is worse than failing loudly at boot.
 */
export function createEmailProvider(config: { resendApiKey?: string; from: string; nodeEnv?: string }): EmailProvider {
  if (config.resendApiKey) return new ResendEmailProvider(config.resendApiKey, config.from);
  if (config.nodeEnv === "production") throw new Error("RESEND_API_KEY is required in production");
  return new ConsoleEmailProvider();
}
