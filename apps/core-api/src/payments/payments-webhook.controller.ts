import { Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { RazorpaySignatureGuard } from "./guards/razorpay-signature.guard";
import { PaymentsService } from "./payments.service";

// No JWT/tenant guard at all — Razorpay can't send one. RazorpaySignatureGuard
// is the entire trust boundary here. Always acks 200 once the signature is
// valid, even for an event we choose to ignore (e.g. an unresolvable
// providerOrderId) or a duplicate delivery — a non-2xx response makes
// Razorpay retry, which is only useful for transient failures on our end,
// not "we understood this and chose not to act on it."
@Controller("payments/webhooks")
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("razorpay")
  @UseGuards(RazorpaySignatureGuard)
  @HttpCode(200)
  async razorpay(@Req() req: RawBodyRequest<Request>) {
    await this.payments.handleWebhookEvent(req.rawBody!.toString("utf8"));
    return { ok: true };
  }
}
