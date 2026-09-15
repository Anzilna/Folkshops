import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PAYMENT_GATEWAY, PaymentProvider } from "../payment-provider.interface";

/**
 * The webhook's only authentication — Razorpay can't send a JWT/cookie,
 * so this guard is the entire trust boundary for POST /payments/webhooks/
 * razorpay (see PaymentsWebhookModule's comment on why that route has no
 * other guards at all). Reads the raw body captured by
 * NestFactory.create(AppModule, { rawBody: true }) in main.ts — req.body
 * (the parsed JSON) is NOT byte-identical to what Razorpay actually
 * signed, so verification must run against req.rawBody specifically.
 */
@Injectable()
export class RazorpaySignatureGuard implements CanActivate {
  constructor(@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentProvider) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const signature = req.header("x-razorpay-signature");
    if (!signature || !req.rawBody) {
      throw new UnauthorizedException("Missing webhook signature or raw body");
    }
    const valid = this.gateway.verifyWebhookSignature({ rawBody: req.rawBody.toString("utf8"), signature });
    if (!valid) throw new UnauthorizedException("Invalid webhook signature");
    return true;
  }
}
