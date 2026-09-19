import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { DbRouter } from "../database/db-router";
import { orders, outboxEvents, paymentEvents, paymentOrderLookup, payments } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import type { Db } from "../database/tokens";
import { PaymentAccountsService } from "./payment-accounts.service";
import { PAYMENT_GATEWAY, PaymentProvider } from "./payment-provider.interface";

const PAYABLE_ORDER_STATUSES = ["pending", "awaiting_payment", "payment_failed"] as const;

/** Pure — no DB, no provider call — so it's unit-testable without mocking
 * the world. Used by initiatePayment() before anything else runs. */
export function isPayableOrderStatus(status: string): boolean {
  return (PAYABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * The order-status side of the payment state machine (see orders.ts
 * schema comment for the full transition table). Pure and exported
 * specifically so this mapping is unit-tested directly. `checkout.session.
 * completed` with payment_status "paid" is the success path; card
 * payments in Stripe Checkout settle synchronously, so a customer who
 * hits a decline just retries within the same (not-yet-completed)
 * session — `checkout.session.expired` (abandoned or truly failed past
 * retry) is what actually marks an order payment_failed, not a per-attempt
 * decline event. Returns `orderStatus: null` for any event/status this
 * doesn't recognize — applyPaymentResult() only updates orders.status
 * when this returns non-null.
 */
export function derivePaymentTransition(
  eventType: string,
  sessionPaymentStatus?: string,
): {
  paymentStatus: "captured" | "failed" | null;
  orderStatus: "paid" | "payment_failed" | null;
} {
  if (eventType === "checkout.session.completed" && sessionPaymentStatus === "paid") {
    return { paymentStatus: "captured", orderStatus: "paid" };
  }
  if (eventType === "checkout.session.expired") {
    return { paymentStatus: "failed", orderStatus: "payment_failed" };
  }
  return { paymentStatus: null, orderStatus: null };
}

export interface CheckoutInfo {
  paymentId: string;
  /** Redirect the customer's browser here — Stripe's own hosted Checkout
   * page. */
  url: string;
}

/**
 * Owns every write to payments/payment_events/orders.status past checkout
 * — deliberately does not go through OrdersService (which isn't exported
 * for reuse today, see orders.module.ts), since a payment update and its
 * corresponding order-status update must commit in the same transaction
 * regardless.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dbRouter: DbRouter,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentProvider,
    private readonly paymentAccounts: PaymentAccountsService,
  ) {}

  /**
   * Idempotent by (tenantId, idempotencyKey) — a real DB unique
   * constraint, not an app-level check-then-insert (see payments.ts
   * schema comment). The conflict check happens BEFORE any call to
   * Stripe, so a retried request never creates a second Checkout Session:
   * `ON CONFLICT DO NOTHING RETURNING *` either returns the freshly
   * inserted row (a genuinely new attempt — proceed to call Stripe) or
   * nothing (already exists — re-fetch the existing session's url).
   */
  async initiatePayment(
    tenantId: string,
    orderId: string,
    customerId: string,
    idempotencyKey: string,
    returnUrl: string,
  ): Promise<CheckoutInfo | null> {
    // Resolved before the transaction below (its own separate read/tenant
    // context, not nested inside the write transaction) — the actual
    // server-side gate: a customer can never pay a store that hasn't
    // connected Stripe, no matter what the storefront UI shows or hides.
    // linkedAccountId is what makes the destination-charge split happen
    // in createCheckoutSession() below.
    const connectAccount = await this.paymentAccounts.getForTenant(tenantId);
    if (!connectAccount?.live) {
      throw new BadRequestException("This store hasn't set up payments yet");
    }

    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [order] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)))
          .limit(1);
        if (!order) return null;
        if (!isPayableOrderStatus(order.status)) {
          throw new BadRequestException(`Order is not payable (status: ${order.status})`);
        }

        const [inserted] = await tx
          .insert(payments)
          .values({ tenantId, orderId, idempotencyKey, amountCents: order.subtotalCents, currency: "aed" })
          .onConflictDoNothing({ target: [payments.tenantId, payments.idempotencyKey] })
          .returning();

        if (inserted) {
          // Genuinely new — create the Checkout Session now, inside the
          // same transaction as the row that reserves this idempotency
          // key, so a crash between the two never leaves an orphaned
          // Stripe session with no local record of it.
          const result = await this.gateway.createCheckoutSession({
            amountCents: inserted.amountCents,
            currency: inserted.currency,
            receipt: inserted.id,
            connectedAccountId: connectAccount.linkedAccountId!,
            successUrl: `${returnUrl}?paid=1`,
            cancelUrl: `${returnUrl}?canceled=1`,
            idempotencyKey,
          });
          const [updated] = await tx
            .update(payments)
            .set({ providerOrderId: result.providerSessionId, updatedAt: new Date() })
            .where(eq(payments.id, inserted.id))
            .returning();
          await tx.insert(paymentOrderLookup).values({
            providerOrderId: result.providerSessionId,
            tenantId,
            orderId,
            paymentId: inserted.id,
          });
          if (order.status !== "awaiting_payment") {
            await tx.update(orders).set({ status: "awaiting_payment", updatedAt: new Date() }).where(eq(orders.id, orderId));
          }
          return { paymentId: updated!.id, url: result.url };
        }

        // Conflict — an attempt with this idempotency key already exists.
        // No second call to Stripe; re-fetch the existing session's url
        // (Checkout Session urls stay valid until the session completes
        // or expires).
        const [existing] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, idempotencyKey)))
          .limit(1);
        if (!existing || !existing.providerOrderId) {
          // Shouldn't happen — a row exists but never got a
          // providerOrderId, meaning a previous attempt crashed between
          // the insert and the Stripe call. Surfacing this as a 400
          // rather than silently retrying the provider call from inside a
          // conflict branch (that would reintroduce the exact
          // double-call risk this is meant to prevent) — a genuinely new
          // idempotency key on the client's next retry is the correct
          // recovery path.
          throw new BadRequestException("A previous payment attempt is in an inconsistent state — retry with a new request");
        }
        const session = await this.gateway.fetchCheckoutSession(existing.providerOrderId);
        if (!session.url) {
          throw new BadRequestException("This payment attempt has already completed or expired — retry with a new request");
        }
        return { paymentId: existing.id, url: session.url };
      }),
    );
  }

  /**
   * The authoritative confirmation path — Stripe's server-to-server
   * webhook, not anything the browser reports. Signature verification
   * (StripeSignatureGuard) has already run before this method is even
   * called; this method's own job is tenant resolution + idempotency +
   * the actual state update.
   */
  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") {
      this.logger.log(`Webhook event "${event.type}" — not one this codebase acts on, ignoring`);
      return;
    }
    const session = event.data.object as Stripe.Checkout.Session;

    // Resolve tenant BEFORE any tenant context exists — payment_order_lookup
    // is deliberately not RLS-protected for exactly this read. See its own
    // schema comment.
    const lookup = await this.dbRouter.read("strong", (db) =>
      db
        .select()
        .from(paymentOrderLookup)
        .where(eq(paymentOrderLookup.providerOrderId, session.id))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    );
    if (!lookup) {
      this.logger.warn(`Webhook for unknown providerOrderId ${session.id} — ignoring`);
      return;
    }

    await this.dbRouter.write((db) =>
      withTenantContext(db, lookup.tenantId, async (tx) => {
        const [inserted] = await tx
          .insert(paymentEvents)
          .values({
            tenantId: lookup.tenantId,
            paymentId: lookup.paymentId,
            eventType: event.type,
            // Stripe's own event.id — always present, unlike Razorpay's
            // payload (which needed a derived-hash fallback, CLAUDE.md bug
            // #20). Stable across redeliveries of the same event.
            providerEventId: event.id,
            payload: event as unknown as Record<string, unknown>,
          })
          .onConflictDoNothing({ target: [paymentEvents.tenantId, paymentEvents.providerEventId] })
          .returning();

        if (!inserted) {
          // Already processed this exact delivery — this is what stops
          // Stripe's retry loop from repeating the side effects below.
          this.logger.log(`Duplicate webhook delivery ${event.id} — no-op`);
          return;
        }

        const [payment] = await tx.select().from(payments).where(eq(payments.id, lookup.paymentId)).limit(1);
        if (!payment) {
          this.logger.error(`payment_order_lookup pointed at missing payment ${lookup.paymentId}`);
          return;
        }

        await this.applyPaymentResult(tx, payment, lookup.tenantId, lookup.orderId, event.type, session);
      }),
    );
  }

  private async applyPaymentResult(
    tx: Db,
    payment: typeof payments.$inferSelect,
    tenantId: string,
    orderId: string,
    eventType: string,
    session: Stripe.Checkout.Session,
  ) {
    const { paymentStatus, orderStatus } = derivePaymentTransition(eventType, session.payment_status);
    const providerPaymentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

    await tx
      .update(payments)
      .set({
        providerPaymentId: providerPaymentId ?? payment.providerPaymentId,
        status: paymentStatus ?? payment.status,
        failureReason: paymentStatus === "failed" ? "Checkout session expired or was abandoned" : payment.failureReason,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    if (orderStatus) {
      await tx.update(orders).set({ status: orderStatus, updatedAt: new Date() }).where(eq(orders.id, orderId));
    }

    // Outbox — written in this same transaction as the state change it
    // reports, so it's exactly as durable as the change itself (see
    // outbox-events.ts's own comment). apps/workers picks this up async;
    // core-api never touches Redis/BullMQ directly here, keeping the
    // webhook handler's own commit fast regardless of queue health.
    if (orderStatus === "paid") {
      await tx.insert(outboxEvents).values({
        tenantId,
        eventType: "order.paid",
        payload: { orderId, paymentId: payment.id },
      });
    }
  }
}
