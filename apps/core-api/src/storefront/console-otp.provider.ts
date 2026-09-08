import { Injectable, Logger } from "@nestjs/common";
import type { OtpProvider } from "./otp-provider";

/**
 * Dev/CI stand-in — logs the code instead of sending a real SMS. Real
 * delivery needs a vendor (MSG91/Twilio/AWS SNS — not yet chosen, needs an
 * account + API key this environment doesn't have) implementing the same
 * OtpProvider interface. Same pattern as DbRouter's replica: a real
 * interface, a fake backing locally, swapped for the real thing once a
 * vendor is chosen — never wire this into a production build.
 */
@Injectable()
export class ConsoleOtpProvider implements OtpProvider {
  private readonly logger = new Logger(ConsoleOtpProvider.name);

  async send(phone: string, code: string): Promise<void> {
    this.logger.warn(`[DEV OTP] ${phone} -> ${code} (no real SMS sent — see ConsoleOtpProvider)`);
  }
}
