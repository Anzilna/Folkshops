import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Razorpay from "razorpay";
import {
  CreateLinkedAccountInput,
  CreateLinkedAccountResult,
  CreateOrderInput,
  CreateOrderResult,
  FetchPaymentResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  TransferResult,
  TransferToLinkedAccountInput,
  VerifyPaymentInput,
  VerifyWebhookInput,
} from "../payment-provider.interface";

/**
 * Config read lazily inside a private client() method, never the
 * constructor — same posture as S3Service.configured() and for the same
 * reason (CLAUDE.md bug #15): Nest builds every provider at boot
 * regardless of whether a request ever reaches it, so a missing
 * RAZORPAY_* var must fail only the one request that needs it, not the
 * entire app.
 *
 * Signature verification is hand-rolled (HMAC-SHA256 via node:crypto)
 * rather than imported from razorpay's own utils module: that function
 * exists (razorpay/dist/utils/razorpay-utils.js), but (a) it's not a
 * public/stable import path — only Razorpay.validateWebhookSignature is
 * exposed as a static, not validatePaymentVerification — and (b) it
 * compares the computed signature with a plain `===`, not a timing-safe
 * comparison; verified in this SDK's own source before deciding to
 * reimplement rather than trust it. The algorithm itself (confirmed
 * against that same source, and against Razorpay's own docs) is
 * identical: HMAC-SHA256, hex-encoded, of `orderId|paymentId` for a
 * payment signature or the raw request body for a webhook signature.
 */
@Injectable()
export class RazorpayProvider implements PaymentProvider {
  private readonly logger = new Logger(RazorpayProvider.name);

  constructor(private readonly config: ConfigService) {}

  private client(): { instance: Razorpay; keySecret: string; webhookSecret: string | null } | null {
    const keyId = this.config.get<string>("RAZORPAY_KEY_ID");
    const keySecret = this.config.get<string>("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) return null;
    const webhookSecret = this.config.get<string>("RAZORPAY_WEBHOOK_SECRET") ?? null;
    return { instance: new Razorpay({ key_id: keyId, key_secret: keySecret }), keySecret, webhookSecret };
  }

  private require() {
    const client = this.client();
    if (!client) {
      this.logger.error("Payment attempted but RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET aren't set");
      throw new InternalServerErrorException("Payments aren't configured in this environment");
    }
    return client;
  }

  /** HMAC-SHA256(message, secret), hex-encoded, compared with
   * crypto.timingSafeEqual rather than `===` — a plain string comparison
   * leaks timing information proportional to how many leading bytes
   * match, which is exactly the class of bug signature verification
   * exists to avoid. Both buffers must be equal length before
   * timingSafeEqual will even run (it throws otherwise), so a length
   * mismatch is checked and treated as "not equal" first. */
  private verifyHmac(message: string, signature: string, secret: string): boolean {
    const expected = createHmac("sha256", secret).update(message).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  getPublicKey(): string {
    const keyId = this.config.get<string>("RAZORPAY_KEY_ID");
    if (!keyId) {
      this.logger.error("Payment attempted but RAZORPAY_KEY_ID isn't set");
      throw new InternalServerErrorException("Payments aren't configured in this environment");
    }
    return keyId;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const { instance } = this.require();
    const order = await instance.orders.create({
      amount: input.amountCents,
      currency: input.currency,
      receipt: input.receipt,
      // Order-time split: Razorpay transfers the linked account's share
      // automatically as part of capturing this order, rather than
      // needing a separate post-capture transfer call. See
      // transferToLinkedAccount() for the alternative (post-facto) path,
      // kept for cases where the split amount isn't known until after
      // capture.
      ...(input.linkedAccountId
        ? {
            transfers: [
              {
                account: input.linkedAccountId,
                amount: input.amountCents,
                currency: input.currency,
              },
            ],
          }
        : {}),
    });
    return { providerOrderId: order.id };
  }

  async fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult> {
    const { instance } = this.require();
    const payment = await instance.payments.fetch(providerPaymentId);
    return { status: payment.status, amountCents: Number(payment.amount), currency: payment.currency };
  }

  verifyPaymentSignature(input: VerifyPaymentInput): boolean {
    const { keySecret } = this.require();
    return this.verifyHmac(`${input.providerOrderId}|${input.providerPaymentId}`, input.signature, keySecret);
  }

  verifyWebhookSignature(input: VerifyWebhookInput): boolean {
    const { webhookSecret } = this.require();
    if (!webhookSecret) {
      this.logger.error("Webhook received but RAZORPAY_WEBHOOK_SECRET isn't set");
      throw new InternalServerErrorException("Webhook verification isn't configured in this environment");
    }
    return this.verifyHmac(input.rawBody, input.signature, webhookSecret);
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const { instance } = this.require();
    const refund = await instance.payments.refund(input.providerPaymentId, {
      ...(input.amountCents !== undefined ? { amount: input.amountCents } : {}),
      // A fresh idempotency anchor per refund attempt, distinct from our
      // own DB-level idempotency (payments.idempotencyKey) — this is
      // Razorpay's own dedup key for the refund call itself.
      receipt: randomUUID(),
    });
    return { providerRefundId: refund.id, status: (refund as { status?: string }).status ?? "processed" };
  }

  /** Calls Razorpay's Partner sub-merchant onboarding endpoint
   * (accounts.create — https://razorpay.com/docs/api/partners/account-onboarding/)
   * via the SDK's own `accounts` resource, confirmed present in the
   * installed razorpay@2.9.8 package (not every SDK version wraps this —
   * checked node_modules/razorpay/dist/types/accounts.d.ts directly
   * before writing this rather than assuming). */
  async createLinkedAccount(input: CreateLinkedAccountInput): Promise<CreateLinkedAccountResult> {
    const { instance } = this.require();
    const account = await instance.accounts.create({
      email: input.email,
      phone: input.phone,
      legal_business_name: input.legalBusinessName,
      business_type: input.businessType,
      contact_name: input.contactName,
      profile: {
        category: input.category,
        subcategory: input.subcategory,
        addresses: {
          registered: {
            street1: input.registeredAddress.street1,
            street2: input.registeredAddress.street2 ?? "",
            city: input.registeredAddress.city,
            state: input.registeredAddress.state,
            postal_code: input.registeredAddress.postalCode,
            country: input.registeredAddress.country,
          },
        },
      },
      ...(input.pan || input.gst ? { legal_info: { pan: input.pan, gst: input.gst } } : {}),
    });
    return { linkedAccountId: account.id, status: account.status };
  }

  /** Post-capture split — see createOrder()'s comment on the order-time
   * alternative. Used when the split amount/destination isn't decided
   * until after the payment is already captured. */
  async transferToLinkedAccount(input: TransferToLinkedAccountInput): Promise<TransferResult> {
    const { instance } = this.require();
    const transfer = await instance.payments.transfer(input.providerPaymentId, {
      transfers: [{ account: input.linkedAccountId, amount: input.amountCents, currency: "INR" }],
    });
    const first = (transfer as { items?: Array<{ id: string; status: string }> }).items?.[0];
    if (!first) throw new InternalServerErrorException("Razorpay transfer response had no items");
    return { transferId: first.id, status: first.status };
  }
}
