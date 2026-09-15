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

## Route/Linked Accounts — and the activation gate

Confirmed via explicit direction: a store must connect and activate a Route Linked Account before its checkout works at all — this isn't an optional enhancement layered on top of a working platform-level flow, it's a hard precondition. `payment_accounts` (one row per tenant) holds the KYC submission (legal business name, business type, category/subcategory, PAN/GST, registered address — every enum value checked against Razorpay's own integration guide before hardcoding a `merchant-admin` dropdown, since a wrong value fails the whole submission) and Razorpay's own cached response (`linkedAccountId`, `status`, `live`, `activatedAt`).

`live` is the actual gate, not `status` — confirmed against the installed SDK's `accounts.d.ts`: `activated_at` stays `null` and `live` stays `false` until Razorpay's own (external, asynchronous) account review completes, something this codebase cannot speed up. `PaymentsService.initiatePayment()` checks `PaymentAccountsService.isPaymentsEnabled()` server-side before ever calling Razorpay — the storefront also reads the same flag (via a public `paymentsEnabled` boolean on `GET /storefront/store`) to hide "Continue to payment" in the UI, but that's convenience, not the enforcement; a customer can never pay a store that hasn't activated, regardless of what the frontend shows.

`RazorpayProvider.createOrder()` attaches a Route `transfers` array at order-creation time whenever a tenant has a live linked account, so the split happens automatically as part of Razorpay capturing the payment — no separate post-capture transfer call needed for the common case. `RazorpayProvider.transferToLinkedAccount()` exists for the alternative (post-facto) path, used when the split amount/destination isn't decided until after capture.

`PaymentAccountsService` lives in `PaymentsCoreModule` (not paired with `AuthModule`, even though its own controller is staff-only) specifically so `StorefrontPaymentsModule`/`StoreController` can read `isPaymentsEnabled()` without transitively importing `AuthModule` and recreating bug #7's `JwtService` collision one level indirect against `StorefrontModule`'s own customer `JwtModule` — see `PaymentsCoreModule`'s own comment.

merchant-admin's `/settings/payments` submits the KYC form once (no edit/resubmit flow — Razorpay's `accounts.edit()` for correcting a submission is a real follow-up, not built) and has a manual "Refresh status" button that re-fetches the account from Razorpay directly. Deliberately not a background poller or a `account.activated`-style webhook subscription — Razorpay's own review has unpredictable timing and nothing here needs to react to the transition within seconds of it happening; a merchant clicking refresh is enough for a one-time state change.

## What's explicitly not built

- No Kafka, no separate payments microservice — nothing here needs either, matches the project's standing anti-overengineering principle.
- No per-tenant "paste your own separate Razorpay account" alternative to Route — superseded by going straight to Route/Linked Accounts per explicit direction, so no credential-encryption question ever arose (Route calls all use the platform's own env-var key pair; `payment_accounts` stores no secrets, just a Linked Account id and KYC metadata).
- No RBAC gating on who can touch payment settings — matches the project-wide deferred `RolesGuard`/`@Roles()`.
- No saved cards/tokenization, no delayed/manual capture, no multi-currency — auto-capture, INR only, one-shot.
- No BullMQ/general job queue for the async order-state side effect after a webhook — just enough of an outbox table + a simple poller to keep the webhook handler itself synchronous-DB-only, not a general event system (this piece, Slice 5, is still not built).
- No KYC-correction/resubmission flow, no automated Razorpay-review status polling or document-upload pipeline beyond the one-shot `createLinkedAccount()` call plus a manual refresh.

## What's verified vs. not

**Verified live, this session, against real Postgres/Redis and a real running core-api:**
- Every Razorpay API shape referenced in this codebase (order create, payment fetch, signature verification, Route accounts/transfers, account status fetch) checked directly against the installed `razorpay@2.9.8` SDK's own `.d.ts` files and Razorpay's live documentation before being used — not assumed from memory or an older API version. Every `business_type`/`category` enum value in merchant-admin's KYC form checked the same way.
- The signature-verification HMAC construction was checked against the SDK's own source (`razorpay/dist/utils/razorpay-utils.js`) before this codebase's own implementation was written; found and deliberately did not reuse the SDK's comparison (`===`, not timing-safe) — see `RazorpayProvider`'s own comment, CLAUDE.md bug #20.
- A real DI wiring bug caught by actually booting the app, not by any type check: `PaymentsCoreModule` originally exported `PaymentsService` but not the `PAYMENT_GATEWAY` token itself, so `RazorpaySignatureGuard` (which injects `PAYMENT_GATEWAY` directly) failed to resolve at boot with `UnknownDependenciesException` — same class of gap as bug #3.
- A real pre-existing test-cleanup gap surfaced by this work, not caused by it: `test-utils/bootstrap-app.ts`'s `cleanupTestTenant()` never deleted `cart_items`/`carts`/`orders`/`order_items`, because no integration test before `storefront-payments.integration.spec.ts` had ever exercised the cart→checkout flow. Fixed, same class of gap as bug #17.
- A real Docker side effect found while getting this running: the container's own `pnpm install` (needed after adding the `razorpay` dependency) wrote Linux-native `node_modules` onto the *host's* disk for every workspace app except `core-api` (the only one with a dedicated named volume), through the bind mount — breaking host-side `eslint` in unrelated apps with no docker-compose-visible cause. Fixed by reinstalling natively on the host; see CLAUDE.md bug #16.
- Full unit suite (idempotency short-circuit logic including the payments-enabled gate, HMAC signature verification against known test vectors, the payment/order state-transition mapping) — 35 tests, all passing, mocked Razorpay HTTP throughout.
- Full integration suite against real Postgres/Redis, mocked Razorpay HTTP, including a genuinely concurrent double-submit of the same Idempotency-Key and a redelivered webhook — 31 tests, all passing.
- Full RLS suite, including the new `payments`/`payment_events`/`payment_accounts` tables under concurrent cross-tenant load — 44 tests, all passing.
- Typecheck and lint clean across `core-api`, `storefront`, `merchant-admin`.

**Not yet verified:**
- No real Razorpay test-mode transaction has been attempted end-to-end through the actual storefront UI in a browser — the "verified" bar this project holds itself to (see every other ADR's own closing section) requires that before this is called fully done, not just green automated tests.
- Refunds (Slice 4) and the minimal outbox/worker (Slice 5) are unbuilt, so nothing about them is verified either.
