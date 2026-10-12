import { Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import type Stripe from "stripe";
import { StripeBillingSignatureGuard } from "./guards/stripe-billing-signature.guard";
import { SubscriptionsService } from "./subscriptions.service";

// No JWT/tenant guard — Stripe can't send one. StripeBillingSignatureGuard
// is the entire trust boundary, same posture as PaymentsWebhookController.
// A SEPARATE URL from /payments/webhooks/stripe — a distinct Stripe
// webhook endpoint registration, distinct signing secret (see ADR 0012).
@Controller("subscriptions/webhooks")
export class SubscriptionsWebhookController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post("stripe")
  @UseGuards(StripeBillingSignatureGuard)
  @HttpCode(200)
  async stripe(@Req() req: RawBodyRequest<Request> & { stripeSubscriptionEvent?: Stripe.Event }) {
    await this.subscriptions.handleWebhookEvent(req.stripeSubscriptionEvent!);
    return { ok: true };
  }
}
