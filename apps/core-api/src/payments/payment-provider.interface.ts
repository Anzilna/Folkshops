/**
 * Same swap-seam pattern as OTP_PROVIDER (storefront/otp-provider.ts) —
 * one Symbol token, one interface, bound via `useClass` in a module. A
 * second gateway (Cashfree) implements this same interface and swaps in
 * via the module binding; nothing in PaymentsService or checkout/webhook
 * code needs to change.
 */
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");

export interface CreateOrderInput {
  amountCents: number;
  currency: string;
  /** Our own payment id — passed as the provider's "receipt" field so a
   * provider-side order can always be traced back to our row, even before
   * providerOrderId is known to us. */
  receipt: string;
  /** Route: split this order's payment to a tenant's Linked Account at
   * capture time. Omitted entirely for a platform-level (Slice 1/2)
   * payment that isn't routed anywhere. */
  linkedAccountId?: string;
}

export interface CreateOrderResult {
  providerOrderId: string;
}

export interface FetchPaymentResult {
  status: string;
  amountCents: number;
  currency: string;
}

export interface VerifyPaymentInput {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface VerifyWebhookInput {
  /** The exact raw request body bytes, as a string — never the
   * re-serialized/parsed JSON, which is not byte-identical to what
   * Razorpay actually signed. */
  rawBody: string;
  signature: string;
}

export interface RefundInput {
  providerPaymentId: string;
  /** Omit for a full refund of whatever remains refundable. */
  amountCents?: number;
}

export interface RefundResult {
  providerRefundId: string;
  status: string;
}

/** Route/Linked Account creation — the KYC-style onboarding fields
 * Razorpay's v2/accounts (Partner sub-merchant) API requires. See
 * RazorpayProvider.createLinkedAccount() for the exact field mapping. */
export interface CreateLinkedAccountInput {
  email: string;
  phone: string;
  legalBusinessName: string;
  businessType: string;
  contactName: string;
  category: string;
  subcategory: string;
  pan?: string;
  gst?: string;
  registeredAddress: {
    street1: string;
    street2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

export interface CreateLinkedAccountResult {
  linkedAccountId: string;
  status: string;
}

export interface TransferToLinkedAccountInput {
  providerPaymentId: string;
  linkedAccountId: string;
  amountCents: number;
}

export interface TransferResult {
  transferId: string;
  status: string;
}

export interface PaymentProvider {
  /** The provider's public client identifier (Razorpay's key_id) — safe
   * to return to the browser, unlike the paired secret. The checkout
   * response the storefront receives carries this so it can initialize
   * the provider's own JS SDK; a future Cashfree implementation returns
   * whatever its equivalent public app id is. */
  getPublicKey(): string;
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult>;
  verifyPaymentSignature(input: VerifyPaymentInput): boolean;
  verifyWebhookSignature(input: VerifyWebhookInput): boolean;
  refund(input: RefundInput): Promise<RefundResult>;
  createLinkedAccount(input: CreateLinkedAccountInput): Promise<CreateLinkedAccountResult>;
  transferToLinkedAccount(input: TransferToLinkedAccountInput): Promise<TransferResult>;
}
