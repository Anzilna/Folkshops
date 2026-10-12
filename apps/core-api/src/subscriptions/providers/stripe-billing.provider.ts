import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import {
  BillingProvider,
  CreateBillingCheckoutInput,
  CreateBillingCheckoutResult,
  CreateBillingCustomerResult,
} from "../billing-provider.interface";

/**
 * Config read lazily inside client()/require(), never the constructor —
 * same CLAUDE.md bug #15 discipline as StripeProvider: a missing
 * STRIPE_SECRET_KEY must fail only the one request that needs it, not
 * take down the whole app at boot.
 *
 * Uses the SAME STRIPE_SECRET_KEY as StripeProvider (payments/) — this is
 * the platform's own Stripe account either way; subscription billing and
 * Connect payments are just two different API surfaces of that one
 * account, not two different Stripe accounts.
 */
@Injectable()
export class StripeBillingProvider implements BillingProvider {
  private readonly logger = new Logger(StripeBillingProvider.name);

  constructor(private readonly config: ConfigService) {}

  private client(): { instance: Stripe; webhookSecret: string | null } | null {
    const secretKey = this.config.get<string>("STRIPE_SECRET_KEY");
    if (!secretKey) return null;
    const webhookSecret = this.config.get<string>("STRIPE_SUBSCRIPTIONS_WEBHOOK_SECRET") ?? null;
    return { instance: new Stripe(secretKey), webhookSecret };
  }

  private require() {
    const client = this.client();
    if (!client) {
      this.logger.error("Billing operation attempted but STRIPE_SECRET_KEY isn't set");
      throw new InternalServerErrorException("Billing isn't configured in this environment");
    }
    return client;
  }

  async createCustomer(email: string, tenantId: string): Promise<CreateBillingCustomerResult> {
    const { instance } = this.require();
    // tenantId in metadata so the Stripe Dashboard is traceable back to a
    // tenant by a human without needing this codebase's own DB — the
    // subscription_customer_lookup table is what code actually queries.
    const customer = await instance.customers.create({ email, metadata: { tenantId } });
    return { customerId: customer.id };
  }

  async createCheckoutSession(input: CreateBillingCheckoutInput): Promise<CreateBillingCheckoutResult> {
    const { instance } = this.require();
    const session = await instance.checkout.sessions.create({
      mode: "subscription",
      customer: input.stripeCustomerId,
      line_items: [{ price: input.stripePriceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { planId: input.planId },
    });
    if (!session.url) throw new InternalServerErrorException("Stripe Checkout Session had no url");
    return { providerSessionId: session.id, url: session.url };
  }

  async createPortalSession(stripeCustomerId: string, returnUrl: string): Promise<{ url: string }> {
    const { instance } = this.require();
    const session = await instance.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  async updateSubscriptionPrice(stripeSubscriptionId: string, newStripePriceId: string): Promise<void> {
    const { instance } = this.require();
    const subscription = await instance.subscriptions.retrieve(stripeSubscriptionId);
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) throw new InternalServerErrorException("Subscription has no line item to update");
    // proration_behavior defaults to "create_prorations" — Stripe's own
    // recommended default for an immediate plan change, not overridden.
    await instance.subscriptions.update(stripeSubscriptionId, {
      items: [{ id: itemId, price: newStripePriceId }],
    });
  }

  async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
    const { instance } = this.require();
    await instance.subscriptions.cancel(stripeSubscriptionId);
  }

  constructWebhookEvent(input: { rawBody: string; signature: string }): Stripe.Event {
    const { instance, webhookSecret } = this.require();
    if (!webhookSecret) {
      this.logger.error("Webhook received but STRIPE_SUBSCRIPTIONS_WEBHOOK_SECRET isn't set");
      throw new InternalServerErrorException("Webhook verification isn't configured in this environment");
    }
    return instance.webhooks.constructEvent(input.rawBody, input.signature, webhookSecret);
  }
}
