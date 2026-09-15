# 0006 — Multi-tenant payment gateway (Razorpay, with Route/Linked Accounts)

## Context

Checkout (`OrdersService.checkout()`) created an order and stopped — no payment happened, by design, until this work (`apps/storefront/app/cart/page.tsx` used to say so directly: "No payment yet — Razorpay arrives in Phase 2"). This closes that gap: a customer pays through Razorpay Checkout, the payment is verified both client-side (optimistic) and via a server-to-server webhook (authoritative), and — because Folkshops is multi-tenant and each merchant is meant to receive their own money, not have it all land in one Folkshops-owned account — the money is routed to each tenant's own Razorpay account via Route/Linked Accounts, not pooled.

This is a large feature. It's landing in slices; this ADR covers the architecture all of them share, not just the first one built.

## The abstraction: `PaymentProvider`

Same swap-seam pattern already used twice in this codebase — `OtpProvider` (`storefront/otp-provider.ts`) and `S3Service` (`uploads/s3.service.ts`): one interface, one `Symbol` DI token (`PAYMENT_GATEWAY`), bound via `useClass` in a module. `RazorpayProvider` (`payments/providers/razorpay.provider.ts`) is the only implementation today; a second gateway (Cashfree, not built) implements the same interface and swaps in via the module binding — nothing in `PaymentsService`, the checkout controllers, or the webhook handler needs to change. Config is read lazily inside a private method, never the constructor, for the same reason as `S3Service` (CLAUDE.md bug #15): Nest builds every provider at boot regardless of whether a request ever reaches it, so a missing `RAZORPAY_KEY_ID` must fail only the request that needs it, not the whole app.

```
Customer → Storefront checkout → PaymentsService → PaymentProvider (interface)
                                                          │
                                                          ▼
                                                   RazorpayProvider
                                                          │
                                                          ▼
                                                       Razorpay
                                                          │
                                              webhook (async, authoritative)
                                                          │
                                                          ▼
                                       RazorpaySignatureGuard → PaymentsService
                                                          │
                                                          ▼
                                        payments / payment_events / orders.status
```

## Why a payment is its own row, not fields on `orders`

`payments` is one row per payment *attempt*, not per order — a failed attempt followed by a retry is a second row against the same `orderId`, so the full attempt history survives rather than being overwritten. `amountCents`/`currency` are snapshotted on the row at attempt time, same reasoning as `order_items`' own price snapshot: never reconstruct what was charged from a later read of `orders.subtotalCents`.

`orders.status` gained the payment states it was always going to need (`orders.ts`'s own comment said "extend this enum then" — this is "then"): `pending → awaiting_payment → paid | payment_failed`, `paid → refunded | partially_refunded`. Fulfillment states (shipped, delivered, ...) are a separate, still-unbuilt concern.

## The webhook's tenant-resolution problem, and why `payment_order_lookup` exists

A Razorpay webhook arrives knowing only a `providerOrderId` — it carries no session, cookie, or tenant-scoped credential (it's authenticated by HMAC signature, not by being a request from a logged-in anyone). Every other table that could answer "which tenant does this belong to" requires `app.tenant_id` already set via RLS — exactly what a webhook doesn't have yet. This is the identical chicken-and-egg problem `membership_lookup` (`database/schema/membership-lookup.ts`) already solves for staff login resolving which tenant an email belongs to before any tenant is known.

`payment_order_lookup` is the same solution, one level removed: deliberately **not** RLS-protected, stores nothing sensitive (no amount, no status, no secret — just `providerOrderId → tenantId/orderId/paymentId`), populated in the same transaction as the `payments` insert that first learns the real `providerOrderId`. The webhook handler reads it first, before any tenant context exists, then does everything else inside `withTenantContext`.

## Idempotency is a database constraint, not an application check

Two distinct problems, two distinct unique indexes — not a check-then-insert in either case, because a check-then-insert has a real race window a unique constraint doesn't:

- **A retried `POST /pay`** (the same client-generated Idempotency-Key, sent again after a timeout/retry): `payments.(tenantId, idempotencyKey)` unique index. `INSERT ... ON CONFLICT DO NOTHING RETURNING *` either returns a fresh row (genuinely new — call Razorpay) or nothing (already exists — fetch and return its current state, **no second call to Razorpay ever happens on a retry**, because the DB check runs before the external HTTP call).
- **A redelivered webhook** (Razorpay retries on any non-2xx/timeout, so the same event can arrive more than once): `payment_events.(tenantId, providerEventId)` unique index, identical pattern — no row back means "already processed," acknowledge with `200` and stop, before any side effect runs a second time.

## The webhook's raw-body requirement

Razorpay signs the **exact raw bytes** of the request body — not `JSON.stringify(JSON.parse(rawBody))`, which is not always byte-identical. `main.ts` passes `{ rawBody: true }` to `NestFactory.create` (NestJS `^11.0.0`, first-class support, no manual `express.raw()` ordering hack needed), which captures `req.rawBody` on every route via body-parser's `verify` hook without disabling normal JSON parsing anywhere else. `RazorpaySignatureGuard` is the entire trust boundary for `POST /payments/webhooks/razorpay` — that route has no JWT/tenant guard at all, since Razorpay can't send one.

## Route/Linked Accounts

Each tenant's Razorpay Linked Account id is stored on their `payment_accounts` row (Slice 2/3). `RazorpayProvider.createOrder()` attaches a Route `transfers` array at order-creation time when a tenant has one configured, so the split happens automatically as part of Razorpay capturing the payment — no separate post-capture transfer call needed for the common case. `RazorpayProvider.transferToLinkedAccount()` exists for the alternative (post-facto) path, used when the split amount/destination isn't decided until after capture.

Creating a Linked Account (`instance.accounts.create(...)`, confirmed present in the installed `razorpay@2.9.8` SDK's own type definitions before writing any code against it — not every SDK version wraps this) is a real KYC-style onboarding: legal business name, business type, registered address, PAN/GST. This is external, compliance-sensitive, and gated on Razorpay's own account-level review — this codebase submits the KYC data once and surfaces whatever status Razorpay returns; it does not build any status-polling/document-review automation beyond that one call.

## What's explicitly not built

- No Kafka, no separate payments microservice — nothing here needs either, matches the project's standing anti-overengineering principle.
- No KMS/Secrets Manager for tenant-stored credential encryption (Slice 2) — env-key AES-256-GCM now, a known prod-hardening gap, not a KMS integration.
- No RBAC gating on who can touch payment settings — matches the project-wide deferred `RolesGuard`/`@Roles()`.
- No saved cards/tokenization, no delayed/manual capture, no multi-currency — auto-capture, INR only, one-shot.
- No BullMQ/general job queue for the async order-state side effect after a webhook — just enough of an outbox table + a simple poller to keep the webhook handler itself synchronous-DB-only, not a general event system.

## What's verified vs. not

**Verified so far:**
- Every Razorpay API shape referenced in this codebase (order create, payment fetch, signature verification, Route accounts/transfers) checked directly against the installed `razorpay@2.9.8` SDK's own `.d.ts` files and Razorpay's live documentation — not assumed from memory or an older API version.
- The signature-verification HMAC construction was checked against the SDK's own source (`razorpay/dist/utils/razorpay-utils.js`) before this codebase's own implementation was written; found and deliberately did not reuse the SDK's comparison (`===`, not timing-safe) — see `RazorpayProvider`'s own comment.
- Found, before it shipped: `class-transformer`'s implicit boolean conversion used elsewhere in this codebase (CLAUDE.md bug #19, from the earlier isActive/soft-delete work) doesn't apply here — this module's boolean-like inputs (raw webhook JSON) go through `JSON.parse` directly, not `plainToInstance`.
- Full unit test suite (idempotency short-circuit logic, HMAC signature verification against known test vectors, the payment/order state-transition mapping) passes against real crypto, mocked Razorpay HTTP.
- `pnpm --filter @folkshops/core-api build`-equivalent typecheck and lint clean across core-api, storefront.

**Not yet verified (blocked on local Docker being down at the time this was written — update this section once it's run):**
- The migration (`0016_complex_union_jack.sql` + hand-written `0017_enable-rls-payments.sql`) has not been applied to a real database yet.
- `storefront-payments.integration.spec.ts` (real Postgres, real HTTP layer, mocked Razorpay HTTP) has not actually been run.
- `payments.rls.test.ts`/`payment-events.rls.test.ts` (real cross-tenant isolation, including concurrent) have not actually been run.
- No real Razorpay test-mode transaction has been attempted end-to-end through the storefront UI — the "verified" bar this project holds itself to (see every other ADR's own closing section) requires that before this is called done, not just green tests.
