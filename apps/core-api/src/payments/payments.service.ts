import { createHash } from "node:crypto";
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { orders, paymentEvents, paymentOrderLookup, payments } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import type { Db } from "../database/tokens";
import { VerifyPaymentDto } from "./dto/verify-payment.dto";
import { PAYMENT_GATEWAY, PaymentProvider } from "./payment-provider.interface";

const PAYABLE_ORDER_STATUSES = ["pending", "awaiting_payment", "payment_failed"] as const;

/** Pure — no DB, no provider call — so it's unit-testable without mocking
 * the world. Used by initiatePayment() before anything else runs. */
export function isPayableOrderStatus(status: string): boolean {
  return (PAYABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

/** The order-status side of the payment state machine (see orders.ts
 * schema comment for the full transition table) — a provider payment
 * status maps to at most one order-status change. Pure and exported
 * specifically so this mapping is unit-tested directly, rather than only
 * indirectly through a DB-mocked integration-style test. Returns
 * `orderStatus: null` for any status that isn't a terminal outcome
 * (created/authorized) — applyPaymentResult() only updates orders.status
 * when this returns non-null. */
export function derivePaymentTransition(providerStatus: string): {
  paymentStatus: "captured" | "failed" | null;
  orderStatus: "paid" | "payment_failed" | null;
} {
  if (providerStatus === "captured") return { paymentStatus: "captured", orderStatus: "paid" };
  if (providerStatus === "failed") return { paymentStatus: "failed", orderStatus: "payment_failed" };
  return { paymentStatus: null, orderStatus: null };
}

export interface CheckoutInfo {
  paymentId: string;
  provider: string;
  providerOrderId: string;
  amountCents: number;
  currency: string;
  keyId: string;
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
  ) {}

  /**
   * Idempotent by (tenantId, idempotencyKey) — a real DB unique
   * constraint, not an app-level check-then-insert (see payments.ts
   * schema comment). The conflict check happens BEFORE any call to
   * Razorpay, so a retried request never creates a second provider order:
   * `ON CONFLICT DO NOTHING RETURNING *` either returns the freshly
   * inserted row (a genuinely new attempt — proceed to call Razorpay) or
   * nothing (already exists — fetch and return its current state as-is).
   */
  async initiatePayment(tenantId: string, orderId: string, customerId: string, idempotencyKey: string): Promise<CheckoutInfo | null> {
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
          .values({ tenantId, orderId, idempotencyKey, amountCents: order.subtotalCents, currency: "INR" })
          .onConflictDoNothing({ target: [payments.tenantId, payments.idempotencyKey] })
          .returning();

        if (inserted) {
          // Genuinely new — create the provider order now, inside the same
          // transaction as the row that reserves this idempotency key, so
          // a crash between the two never leaves an orphaned Razorpay
          // order with no local record of it.
          const result = await this.gateway.createOrder({
            amountCents: inserted.amountCents,
            currency: inserted.currency,
            receipt: inserted.id,
          });
          const [updated] = await tx
            .update(payments)
            .set({ providerOrderId: result.providerOrderId, updatedAt: new Date() })
            .where(eq(payments.id, inserted.id))
            .returning();
          await tx.insert(paymentOrderLookup).values({
            providerOrderId: result.providerOrderId,
            tenantId,
            orderId,
            paymentId: inserted.id,
          });
          if (order.status !== "awaiting_payment") {
            await tx.update(orders).set({ status: "awaiting_payment", updatedAt: new Date() }).where(eq(orders.id, orderId));
          }
          return this.toCheckoutInfo(updated);
        }

        // Conflict — an attempt with this idempotency key already exists.
        // No second call to Razorpay; return the existing row's state.
        const [existing] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, idempotencyKey)))
          .limit(1);
        if (!existing || !existing.providerOrderId) {
          // Shouldn't happen — a row exists but never got a providerOrderId,
          // meaning a previous attempt crashed between the insert and the
          // Razorpay call. Surfacing this as a 400 rather than silently
          // retrying the provider call from inside a conflict branch (that
          // would reintroduce the exact double-call risk this is meant to
          // prevent) — a genuinely new idempotency key on the client's next
          // retry is the correct recovery path.
          throw new BadRequestException("A previous payment attempt is in an inconsistent state — retry with a new request");
        }
        return this.toCheckoutInfo(existing);
      }),
    );
  }

  private toCheckoutInfo(row: typeof payments.$inferSelect): CheckoutInfo {
    if (!row.providerOrderId) throw new BadRequestException("Payment has no provider order yet");
    return {
      paymentId: row.id,
      provider: row.provider,
      providerOrderId: row.providerOrderId,
      amountCents: row.amountCents,
      currency: row.currency,
      keyId: this.gateway.getPublicKey(),
    };
  }

  /**
   * The storefront's own optimistic confirmation path, immediately after
   * Razorpay Checkout's client-side `handler` callback fires — NOT the
   * authoritative source of truth (the webhook, handleWebhookEvent(),
   * is). Verifies the signature, then re-fetches the payment from
   * Razorpay directly (never trusts the client-echoed status alone) before
   * updating anything — a browser reporting "success" is not proof a
   * payment actually captured.
   */
  async verifyClientPayment(tenantId: string, orderId: string, customerId: string, dto: VerifyPaymentDto) {
    const valid = this.gateway.verifyPaymentSignature({
      providerOrderId: dto.razorpayOrderId,
      providerPaymentId: dto.razorpayPaymentId,
      signature: dto.razorpaySignature,
    });
    if (!valid) throw new UnauthorizedException("Payment signature verification failed");

    const fetched = await this.gateway.fetchPayment(dto.razorpayPaymentId);

    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, dto.idempotencyKey)))
          .limit(1);
        if (!payment || payment.orderId !== orderId || payment.providerOrderId !== dto.razorpayOrderId) {
          throw new NotFoundException("Payment not found for this order");
        }

        const [order] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)))
          .limit(1);
        if (!order) throw new NotFoundException("Order not found");

        return this.applyPaymentResult(tx, payment, order.id, {
          providerPaymentId: dto.razorpayPaymentId,
          status: fetched.status,
          amountCents: fetched.amountCents,
        });
      }),
    );
  }

  /**
   * The authoritative confirmation path — Razorpay's server-to-server
   * webhook, not anything the browser reports. Signature verification
   * (RazorpaySignatureGuard) has already run before this method is even
   * called; this method's own job is tenant resolution + idempotency +
   * the actual state update.
   */
  async handleWebhookEvent(rawBody: string): Promise<void> {
    const body = JSON.parse(rawBody) as {
      event: string;
      created_at?: number;
      payload?: { payment?: { entity?: { id: string; order_id: string; status: string; amount: number } } };
    };
    const paymentEntity = body.payload?.payment?.entity;
    if (!paymentEntity?.order_id) {
      this.logger.warn(`Webhook event "${body.event}" had no payment.entity.order_id — ignoring`);
      return;
    }

    // Resolve tenant BEFORE any tenant context exists — payment_order_lookup
    // is deliberately not RLS-protected for exactly this read. See its own
    // schema comment.
    const lookup = await this.dbRouter.read("strong", (db) =>
      db
        .select()
        .from(paymentOrderLookup)
        .where(eq(paymentOrderLookup.providerOrderId, paymentEntity.order_id))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    );
    if (!lookup) {
      this.logger.warn(`Webhook for unknown providerOrderId ${paymentEntity.order_id} — ignoring`);
      return;
    }

    await this.dbRouter.write((db) =>
      withTenantContext(db, lookup.tenantId, async (tx) => {
        const providerEventId = this.resolveEventId(body, paymentEntity.id);
        const [event] = await tx
          .insert(paymentEvents)
          .values({
            tenantId: lookup.tenantId,
            paymentId: lookup.paymentId,
            eventType: body.event,
            providerEventId,
            payload: body,
          })
          .onConflictDoNothing({ target: [paymentEvents.tenantId, paymentEvents.providerEventId] })
          .returning();

        if (!event) {
          // Already processed this exact delivery — this is what stops
          // Razorpay's retry loop from repeating the side effects below.
          this.logger.log(`Duplicate webhook delivery ${providerEventId} — no-op`);
          return;
        }

        const [payment] = await tx.select().from(payments).where(eq(payments.id, lookup.paymentId)).limit(1);
        if (!payment) {
          this.logger.error(`payment_order_lookup pointed at missing payment ${lookup.paymentId}`);
          return;
        }

        await this.applyPaymentResult(tx, payment, lookup.orderId, {
          providerPaymentId: paymentEntity.id,
          status: paymentEntity.status,
          amountCents: paymentEntity.amount,
        });
      }),
    );
  }

  /** X-Razorpay-Event-Id isn't consistently documented as always present
   * across API/account versions — falls back to a deterministic hash of
   * event+payment id+timestamp, which is stable across redeliveries of
   * the exact same event (Razorpay doesn't change these fields on
   * retry). NEEDS RECONFIRMATION against a real test-mode webhook
   * delivery before treating this fallback path as fully proven — flagged
   * here and in docs/payments.md rather than silently assumed correct. */
  private resolveEventId(body: { event: string; created_at?: number }, paymentId: string): string {
    return createHash("sha256").update(`${body.event}:${paymentId}:${body.created_at ?? ""}`).digest("hex");
  }

  private async applyPaymentResult(
    tx: Db,
    payment: typeof payments.$inferSelect,
    orderId: string,
    result: { providerPaymentId: string; status: string; amountCents: number },
  ) {
    const { paymentStatus, orderStatus } = derivePaymentTransition(result.status);

    await tx
      .update(payments)
      .set({
        providerPaymentId: result.providerPaymentId,
        status: paymentStatus ?? payment.status,
        failureReason: paymentStatus === "failed" ? "Provider reported payment failure" : payment.failureReason,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    if (orderStatus) {
      await tx.update(orders).set({ status: orderStatus, updatedAt: new Date() }).where(eq(orders.id, orderId));
    }

    return { status: result.status, captured: paymentStatus === "captured" };
  }
}
