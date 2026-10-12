import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import type Redis from "ioredis";
import type Stripe from "stripe";
import { DbRouter } from "../database/db-router";
import { outboxEvents, plans, subscriptionCustomerLookup, subscriptions } from "../database/schema";
import type { Db } from "../database/tokens";
import { withTenantContext } from "../database/tenant-context";
import { publishDashboardUpdate } from "../platform-admin/dashboard/platform-admin-realtime";
import { REDIS_CLIENT } from "../redis/tokens";
import { BILLING_GATEWAY, BillingProvider } from "./billing-provider.interface";
import { PlansService } from "./plans.service";

/**
 * Owns everything AFTER a tenant already has a `subscriptions` row —
 * creating it in the first place happens inline in AuthService.register()
 * (same "no repository indirection, the service that owns the transaction
 * does the insert directly" pattern AuthService already uses for
 * tenants/users/memberships). See docs/decisions/0012.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly dbRouter: DbRouter,
    private readonly plansService: PlansService,
    @Inject(BILLING_GATEWAY) private readonly billing: BillingProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private merchantAdminUrl(): string {
    return this.config.get<string>("MERCHANT_ADMIN_URL") ?? "http://localhost:3001";
  }

  async getForTenant(tenantId: string) {
    const row = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [result] = await tx
          .select({ subscription: subscriptions, plan: plans })
          .from(subscriptions)
          .innerJoin(plans, eq(subscriptions.planId, plans.id))
          .where(eq(subscriptions.tenantId, tenantId))
          .limit(1);
        return result ?? null;
      }),
    );
    if (!row) throw new NotFoundException("No subscription found for this tenant");
    return row;
  }

  async createPortalSession(tenantId: string): Promise<{ url: string }> {
    const { subscription } = await this.getForTenant(tenantId);
    if (!subscription.stripeCustomerId) {
      throw new BadRequestException("This plan has no billing account (free plan has nothing to manage)");
    }
    return this.billing.createPortalSession(subscription.stripeCustomerId, `${this.merchantAdminUrl()}/settings/billing`);
  }

  /**
   * Moving to/from the free plan never touches Stripe (nothing to
   * prorate against). Moving between two paid plans updates the existing
   * Stripe subscription's price directly (proration) rather than
   * starting a whole new Checkout Session — the customer already has a
   * payment method on file.
   */
  async changePlan(tenantId: string, newPlanSlug: string): Promise<{ checkoutUrl?: string }> {
    const { subscription, plan: currentPlan } = await this.getForTenant(tenantId);
    const newPlan = await this.plansService.findBySlug(newPlanSlug);
    if (!newPlan) throw new BadRequestException(`Unknown plan: ${newPlanSlug}`);
    if (newPlan.id === currentPlan.id) return {};

    if (subscription.stripeSubscriptionId && newPlan.priceCents > 0) {
      // Paid -> paid: update the existing subscription in place.
      if (!newPlan.stripePriceId) {
        throw new BadRequestException(`Plan ${newPlanSlug} isn't available for purchase yet`);
      }
      await this.billing.updateSubscriptionPrice(subscription.stripeSubscriptionId, newPlan.stripePriceId);
      await this.dbRouter.write((db) =>
        withTenantContext(db, tenantId, (tx) =>
          tx.update(subscriptions).set({ planId: newPlan.id, updatedAt: new Date() }).where(eq(subscriptions.tenantId, tenantId)),
        ),
      );
      return {};
    }

    if (!subscription.stripeSubscriptionId && newPlan.priceCents > 0) {
      // Free -> paid: needs a real Checkout Session (may need a Stripe customer first).
      let stripeCustomerId = subscription.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await this.billing.createCustomer(`tenant-${tenantId}@placeholder.invalid`, tenantId);
        stripeCustomerId = customer.customerId;
        await this.dbRouter.write((db) =>
          withTenantContext(db, tenantId, (tx) =>
            tx.update(subscriptions).set({ stripeCustomerId, updatedAt: new Date() }).where(eq(subscriptions.tenantId, tenantId)),
          ),
        );
        await this.dbRouter.write((db) => db.insert(subscriptionCustomerLookup).values({ stripeCustomerId: stripeCustomerId!, tenantId }));
      }
      if (!newPlan.stripePriceId) {
        throw new BadRequestException(`Plan ${newPlanSlug} isn't available for purchase yet`);
      }
      const session = await this.billing.createCheckoutSession({
        stripeCustomerId,
        stripePriceId: newPlan.stripePriceId,
        planId: newPlan.id,
        successUrl: `${this.merchantAdminUrl()}/settings/billing?checkout=success`,
        cancelUrl: `${this.merchantAdminUrl()}/settings/billing?checkout=cancelled`,
      });
      return { checkoutUrl: session.url };
    }

    // Paid -> free: cancel the Stripe subscription, downgrade immediately.
    if (subscription.stripeSubscriptionId && newPlan.priceCents === 0) {
      await this.billing.cancelSubscription(subscription.stripeSubscriptionId);
    }
    await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, (tx) =>
        tx
          .update(subscriptions)
          .set({ planId: newPlan.id, status: "active", stripeSubscriptionId: null, updatedAt: new Date() })
          .where(eq(subscriptions.tenantId, tenantId)),
      ),
    );
    return {};
  }

  /**
   * Only 3 event types handled (see ADR 0012) — always ACKs 200 once the
   * signature is valid, even for an event type we don't handle, same
   * posture as PaymentsService.handleWebhookEvent().
   */
  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription" || !session.customer) return;
        const tenantId = await this.resolveTenantId(session.customer as string);
        if (!tenantId) return;
        // metadata.planId is set by createCheckoutSession() (see
        // billing-provider.interface.ts) — required for changePlan()'s
        // free->paid path, where nothing already wrote the new planId to
        // our DB before Checkout started (unlike registration, which
        // sets planId upfront in the same transaction as the tenant
        // itself). Falls back to leaving planId untouched if metadata is
        // somehow missing rather than writing garbage.
        const metadataPlanId = session.metadata?.planId;
        await this.dbRouter.write((db) =>
          withTenantContext(db, tenantId, async (tx) => {
            const previous = await this.lockStatus(tx, tenantId);
            await tx
              .update(subscriptions)
              .set({
                status: "active",
                stripeSubscriptionId: session.subscription as string,
                ...(metadataPlanId ? { planId: metadataPlanId } : {}),
                updatedAt: new Date(),
              })
              .where(eq(subscriptions.tenantId, tenantId));
            if (previous !== "active") await this.recordTransition(tx, tenantId, "subscription.activated");
          }),
        );
        void publishDashboardUpdate(this.redis);
        return;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = await this.resolveTenantId(sub.customer as string);
        if (!tenantId) return;
        const status = sub.status === "active" ? "active" : sub.status === "past_due" ? "past_due" : "incomplete";
        // current_period_end lives on each SubscriptionItem, not the
        // Subscription itself, as of this SDK's API version (confirmed
        // against node_modules/stripe's own .d.ts before writing this —
        // Stripe moved it there to support multiple prices per
        // subscription with independent billing cycles). Every
        // subscription in this codebase has exactly one item (one plan =
        // one price), so [0] is always the right one.
        const currentPeriodEnd = sub.items.data[0]?.current_period_end;
        await this.dbRouter.write((db) =>
          withTenantContext(db, tenantId, async (tx) => {
            const previous = await this.lockStatus(tx, tenantId);
            await tx
              .update(subscriptions)
              .set({
                status,
                ...(currentPeriodEnd ? { currentPeriodEnd: new Date(currentPeriodEnd * 1000) } : {}),
                updatedAt: new Date(),
              })
              .where(eq(subscriptions.tenantId, tenantId));
            if (status === "past_due" && previous !== "past_due") await this.recordTransition(tx, tenantId, "subscription.past_due");
          }),
        );
        void publishDashboardUpdate(this.redis);
        return;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = await this.resolveTenantId(sub.customer as string);
        if (!tenantId) return;
        await this.dbRouter.write((db) =>
          withTenantContext(db, tenantId, async (tx) => {
            const previous = await this.lockStatus(tx, tenantId);
            await tx.update(subscriptions).set({ status: "canceled", updatedAt: new Date() }).where(eq(subscriptions.tenantId, tenantId));
            if (previous !== "canceled") await this.recordTransition(tx, tenantId, "subscription.canceled");
          }),
        );
        void publishDashboardUpdate(this.redis);
        return;
      }
      default:
        return;
    }
  }

  /**
   * The status *before* this webhook's update, with the row locked for the
   * rest of the transaction. Stripe retries and re-orders webhooks freely,
   * so emails (apps/workers, via the outbox) are keyed off a real status
   * change, never off "this event type arrived" — two concurrent
   * deliveries of the same event serialize here and only one sees a change.
   */
  private async lockStatus(tx: Db, tenantId: string): Promise<string | null> {
    const [row] = await tx
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .for("update")
      .limit(1);
    return row?.status ?? null;
  }

  /** Same-transaction outbox write — see docs/decisions/0013 for what apps/workers does with it (a billing email to the store's owners). */
  private async recordTransition(tx: Db, tenantId: string, eventType: "subscription.activated" | "subscription.past_due" | "subscription.canceled") {
    const [row] = await tx
      .select({ id: subscriptions.id, planId: subscriptions.planId })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1);
    if (!row) return;
    await tx.insert(outboxEvents).values({
      tenantId,
      eventType,
      aggregateType: "subscription",
      aggregateId: row.id,
      payload: { planId: row.planId },
    });
  }

  /** subscription_customer_lookup is deliberately non-RLS (see subscriptions.ts) — this is the one place that reads it. */
  private async resolveTenantId(stripeCustomerId: string): Promise<string | null> {
    const [row] = await this.dbRouter.read("strong", (db) =>
      db.select().from(subscriptionCustomerLookup).where(eq(subscriptionCustomerLookup.stripeCustomerId, stripeCustomerId)).limit(1),
    );
    return row?.tenantId ?? null;
  }
}
