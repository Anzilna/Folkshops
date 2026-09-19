import { Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import type Stripe from "stripe";
import { StripeSignatureGuard } from "./guards/stripe-signature.guard";
import { PaymentsService } from "./payments.service";

// No JWT/tenant guard at all — Stripe can't send one. StripeSignatureGuard
// is the entire trust boundary here. Always acks 200 once the signature is
// valid, even for an event we choose to ignore (e.g. an unresolvable
// providerSessionId, or an event type we don't handle) or a duplicate
// delivery — a non-2xx response makes Stripe retry, which is only useful
// for transient failures on our end, not "we understood this and chose
// not to act on it."
@Controller("payments/webhooks")
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("stripe")
  @UseGuards(StripeSignatureGuard)
  @HttpCode(200)
  async stripe(@Req() req: RawBodyRequest<Request> & { stripeEvent?: Stripe.Event }) {
    await this.payments.handleWebhookEvent(req.stripeEvent!);
    return { ok: true };
  }
}
