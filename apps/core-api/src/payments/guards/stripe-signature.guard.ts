import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type Stripe from "stripe";
import { PAYMENT_GATEWAY, PaymentProvider } from "../payment-provider.interface";

/**
 * The webhook's only authentication — Stripe can't send a JWT/cookie, so
 * this guard is the entire trust boundary for POST /payments/webhooks/
 * stripe (see PaymentsWebhookModule's comment on why that route has no
 * other guards at all). Reads the raw body captured by
 * NestFactory.create(AppModule, { rawBody: true }) in main.ts — req.body
 * (the parsed JSON) is NOT byte-identical to what Stripe actually signed,
 * so verification must run against req.rawBody specifically. Attaches the
 * verified+parsed event onto the request so the controller never needs to
 * re-parse the body itself.
 */
@Injectable()
export class StripeSignatureGuard implements CanActivate {
  constructor(@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentProvider) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer; stripeEvent?: Stripe.Event }>();
    const signature = req.header("stripe-signature");
    if (!signature || !req.rawBody) {
      throw new UnauthorizedException("Missing webhook signature or raw body");
    }
    try {
      req.stripeEvent = this.gateway.constructWebhookEvent({ rawBody: req.rawBody.toString("utf8"), signature });
    } catch {
      throw new UnauthorizedException("Invalid webhook signature");
    }
    return true;
  }
}
