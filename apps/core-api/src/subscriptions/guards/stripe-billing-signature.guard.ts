import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type Stripe from "stripe";
import { BILLING_GATEWAY, BillingProvider } from "../billing-provider.interface";

/**
 * Near-identical to payments/guards/stripe-signature.guard.ts, deliberately
 * NOT shared — a separate signing secret per Stripe endpoint is what
 * Stripe itself requires (each registered webhook endpoint gets its own
 * secret), and keeping the guard classes distinct means a bug in one
 * webhook's verification can't silently affect the other's. Reads
 * req.rawBody, same NestFactory.create(AppModule, { rawBody: true })
 * requirement as the Connect webhook (see main.ts).
 */
@Injectable()
export class StripeBillingSignatureGuard implements CanActivate {
  constructor(@Inject(BILLING_GATEWAY) private readonly gateway: BillingProvider) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer; stripeSubscriptionEvent?: Stripe.Event }>();
    const signature = req.header("stripe-signature");
    if (!signature || !req.rawBody) {
      throw new UnauthorizedException("Missing webhook signature or raw body");
    }
    try {
      req.stripeSubscriptionEvent = this.gateway.constructWebhookEvent({
        rawBody: req.rawBody.toString("utf8"),
        signature,
      });
    } catch {
      throw new UnauthorizedException("Invalid webhook signature");
    }
    return true;
  }
}
