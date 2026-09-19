# 0006 — Multi-tenant payment gateway (Razorpay, with Route/Linked Accounts)

> **Superseded 2026-09-15** — the gateway was switched from Razorpay to Stripe (Connect, Express accounts). Everything below through "What's verified vs. not" describes the original Razorpay-era design and is kept as the historical record of *why* a payment-gateway abstraction and this exact architecture shape (payment_accounts/payments/payment_events/payment_order_lookup, idempotency-by-constraint, the webhook tenant-resolution problem) exist at all — that reasoning is unchanged under Stripe. For what's actually running today, jump to **"Addendum 2 — full migration to Stripe"** at the bottom.

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

## Addendum 1 — staged "Connect Razorpay" onboarding UX (2026-09-15, superseded same day)

*Itself superseded a few hours later by Addendum 2 below — kept verbatim as the record of why the Route/Linked-Account KYC form was staged into two steps before the decision to drop Razorpay entirely was made.*

The original single-page KYC form (email through registered address, one submit) has been replaced with a two-step "Connect Razorpay" flow in merchant-admin, matching a Stripe-Connect-shaped request: Connect → Onboarding in progress → Pending review → Connected. Before touching any code, current Razorpay documentation was checked (fetched live, not recalled) for a Razorpay-*hosted* redirect equivalent of Stripe's `account_links` — the literal ask.

**Finding — no such thing exists for the Route/Linked-Account model this codebase uses:**
- The Account Onboarding API family (`accounts.create`/`stakeholders.create`/`products.requestProductConfiguration`, everything `RazorpayProvider` calls) is documented as server-to-server only — Razorpay's own Route Integration Guide states directly that *"no pre-built hosted signup flow is offered for merchants to self-onboard directly through Razorpay"* for this model.
- Razorpay does have a genuine hosted, co-branded onboarding redirect — the **Custom Onboarding SDK** — but it belongs to the separate **Technology Partner** program (requires contacting Razorpay to apply, plus a distinct OAuth Application/`client_id`/`client_secret` on the Partner Dashboard), and the account it produces is a **fully independent standalone Razorpay merchant account**, not a Route Linked Account (`account_id` usable in `transfers`). Adopting it would mean abandoning Route/Linked-Account settlement (this ADR's core decision), not extending it.
- Conclusion, put to the user directly rather than faked in code: keep Route/Linked Accounts, keep the onboarding server-to-server, but reduce it to only what `accounts.create()` actually requires up front (email/phone/legal name/business type/contact name/category/subcategory) so a Linked Account exists the moment a merchant clicks "Connect Razorpay," and defer PAN/GST/registered address to a second "Complete business details" step (`accounts.edit()`) — chosen by the user over pursuing Technology Partner status or leaving the form as-is.

**What changed:**
- `payment_accounts.registered_address` is now nullable (migration `0020_purple_corsair.sql`) — a row can exist with just the Step 1 fields.
- `PaymentProvider.createLinkedAccount()` no longer takes `registeredAddress`/`pan`/`gst`; a new `updateLinkedAccount()` (accounts.edit()) takes those, callable once an account already exists.
- `PaymentAccountsController`: `POST /payment-accounts` is Step 1 (unchanged route, fewer required fields); `PATCH /payment-accounts/details` is the new Step 2 (404s if no account exists yet).
- merchant-admin's `/settings/payments` is now the three-state card the user specified (Connect / Onboarding in progress + Complete business details / Pending review or Connected), each step a `Modal` rather than one long page-form.

**Verified this session:**
- Typecheck (`core-api`, `merchant-admin`) and lint both clean.
- Unit suite: 38 passing (added `createLinkedAccount`/`updateLinkedAccount` coverage on `RazorpayProvider`, asserting no address/PAN/GST leaks into the Step 1 call and `legal_info` is only sent when PAN/GST is actually given).
- Integration suite: 37 passing, including a new `payment-accounts.integration.spec.ts` (Step 1 creates with no address, a second connect attempt 409s, Step 2 404s before an account exists and succeeds after, and — real HTTP layer, real guards — a tenant B session cannot read/connect-for/update tenant A's account under `TenantMatchGuard`). `storefront-payments.integration.spec.ts`'s `activatePayments()` setup helper updated to the two real calls instead of one.
- RLS suite: 44 passing, unchanged behavior with the nullable column.
- Live browser click-through (Playwright, real `core-api` in Docker, real Postgres) of all three UI states — screenshots taken, all matched the requested mockup exactly.

**Real finding from the live click-through, not a code bug:** submitting Step 1 against the real `RazorpayProvider` (this environment's actual `RAZORPAY_KEY_ID`/`SECRET`) returned a 500 whose body was Razorpay's own `{code: "BAD_REQUEST_ERROR", description: "Access Denied"}` — the frontend correctly caught and displayed it ("Internal server error"), so this is not a regression. It means **this dev environment's Razorpay credentials are not approved for Route/Partner sub-merchant account creation at all** — a pre-existing gap, not introduced today: the *old* single-step form called this exact same `accounts.create()` endpoint and would have hit the identical wall the first time anyone actually clicked Submit in a browser rather than a mocked test. The remaining two UI states (Pending review, Connected) were therefore verified by seeding `payment_accounts` rows directly rather than through a real Razorpay round-trip. **A real Razorpay Route-enabled test account is required before Step 1/Step 2 can be called "verified" end-to-end** — separate from, and a precondition to, the earlier Technology Partner/hosted-onboarding question above.
- Refunds (Slice 4) and the minimal outbox/worker (Slice 5) are unbuilt, so nothing about them is verified either.

## Addendum 2 — full migration to Stripe (Connect, Express accounts) (2026-09-15)

**Why**: the platform's actual Razorpay account turned out not to be approved for Route/Partner sub-merchant account creation at all (Addendum 1's real finding, confirmed live against the Razorpay Dashboard — no "Route" product listed under Payment Products). Getting that fixed is a Razorpay support request, not a code problem, but at the same time the user wanted the genuine Stripe-Connect-style hosted onboarding UX explored earlier this session (see the merchant-onboarding conversation before Addendum 1) — and Stripe's own Connect product (Express accounts + Account Links, confirmed against current docs, `docs.stripe.com/connect/express-accounts` and `.../account-links`) delivers exactly that, self-serve, with no partner-approval wall: the only prerequisite is completing the platform's own Connect profile once at `dashboard.stripe.com/connect/registration` — an account setting, not an approval process. Decision: drop Razorpay, move the whole gateway to Stripe.

**Architecture choices** (stated, not re-litigated in depth — this was an explicit "finish it fast" request):
- **Express connected accounts**, not Standard or Custom — closest analog to the old Route Linked Account (Stripe hosts the dashboard, KYC, and identity verification; the platform never touches business/bank details).
- **Destination charges** (`payment_intent_data.transfer_data.destination` on the Checkout Session) — the platform account collects the payment and Stripe transfers the connected account's share automatically, the same "platform collects, routes to tenant" shape Route's own `transfers` array had. No `application_fee_amount` — Folkshops doesn't take a platform cut (matches the project's existing one-shot/no-multi-currency simplicity posture).
- **Stripe Checkout** (hosted redirect, `mode: "payment"`), not Stripe Elements embedded in the storefront — fastest to build correctly and secure; the storefront needed zero Stripe.js/script tag at all, just `window.location.href = session.url`.
- **Accounts v1 (legacy) Express accounts**, not the newer Accounts v2 API — checked `docs.stripe.com/connect/accounts-v2` directly: v2 uses a `Stripe-Version: ...preview` header (still preview, not GA) and no confirmed Account-Links-equivalent hosted redirect was found in the fetched docs. v1 Express + Account Links is stable, extremely well-documented, and is literally what "Stripe Connect onboarding" commonly refers to — the safer choice for a fast, correct migration.

**What this eliminated, not just replaced:**
- **The entire KYC form is gone.** `payment_accounts` dropped `email`/`phone`/`legal_business_name`/`business_type`/`contact_name`/`category`/`subcategory`/`pan`/`gst`/`registered_address` — ten columns — down to just `linked_account_id`/`live`/`payouts_enabled`/`details_submitted`/`activated_at`. Folkshops never sees a merchant's business or bank details; Stripe's hosted onboarding collects everything directly. `POST /payment-accounts/connect` takes no request body at all.
- **The client-side "verify payment" step is gone.** Razorpay Checkout.js was a JS widget with a `handler` callback carrying a signature to verify; Stripe Checkout is a pure redirect, so there's nothing to verify client-side — `VerifyPaymentDto`, `verifyClientPayment()`, and `POST /storefront/orders/:id/verify-payment` were deleted outright. The webhook (`checkout.session.completed`) is now the *only* confirmation path, not one of two.
- **The derived-event-id hash fallback is gone** (Addendum 1 / CLAUDE.md bug #20's `resolveEventId()`) — Stripe's `Event.id` is always present, used directly as `payment_events.providerEventId`.

**What stayed the same, deliberately:** the two-table idempotency-by-unique-constraint pattern (`payments.(tenantId, idempotencyKey)`, `payment_events.(tenantId, providerEventId)`), `payment_order_lookup`'s non-RLS pre-tenant-context webhook resolution, the `StripeSignatureGuard`/`RawBodyRequest` raw-body trust boundary, and `PaymentAccountsService`'s placement in `PaymentsCoreModule` to dodge bug #7's `JwtService` collision — none of that reasoning was Razorpay-specific, so none of it changed.

**Files removed outright**: `razorpay.provider.ts`(+spec), `razorpay-signature.guard.ts`(+spec), `verify-payment.dto.ts`, `connect-payment-account.dto.ts`, `update-payment-account-details.dto.ts`, `registered-address.dto.ts`, the `razorpay` npm dependency, `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`. Added: `stripe.provider.ts`(+spec), `stripe-signature.guard.ts`, `stripe@22.6.2`, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`MERCHANT_ADMIN_URL`.

**Migration `0021_stripe-connect-migration.sql` is hand-written**, not `drizzle-kit generate`d — the same precedent as the RLS-enable migrations (0017/0019): dropping ten columns and adding two more triggers `generate`'s interactive rename-vs-drop disambiguation prompts, which can't run non-interactively and risk silently misattributing a dropped column as a rename. The matching `meta/0021_snapshot.json` was hand-crafted from `0020_snapshot.json` to keep `drizzle-kit generate`'s future diffing accurate — confirmed with a real `db:generate` run immediately after migrating: `"No schema changes, nothing to migrate"`.

**Verified this session:**
- Typecheck (`core-api`, `merchant-admin` — `storefront` not separately re-typechecked this pass, only edited two small files with no new types) and lint both clean.
- Unit suite: 31 passing (`stripe.provider.spec.ts` replaces `razorpay.provider.spec.ts` — covers the destination-charge shape, Connect account/link creation, webhook construction, and the "config missing" failure mode; `payments.service.spec.ts` updated for the new `derivePaymentTransition(eventType, paymentStatus)` signature and the url-returning `CheckoutInfo` shape).
- Integration suite: 37 passing — `payment-accounts.integration.spec.ts` rewritten for the one-call Connect flow (creates once, reuses the account on a second call, 404s on refresh before connecting, tenant isolation via `TenantMatchGuard`); `storefront-payments.integration.spec.ts`'s `FakePaymentGateway` and webhook payloads rewritten for Stripe's `checkout.session.completed`/`checkout.session.expired` event shape.
- RLS suite: 44 passing — `payment-accounts.rls.test.ts`'s direct-SQL row insert updated for the new minimal column set; behavior itself unchanged.
- Live-Stripe-credential verification (an actual Stripe test-mode Connect/Checkout round trip) was **not** performed this session — no Stripe test keys were available in this environment. Everything above was verified through the same `PaymentProvider`-swapped fake-gateway discipline every payments test in this codebase already uses (no real Razorpay credentials ever touched CI either). **Before calling this done**, a real Stripe test account needs: the one-time Connect profile setup, real `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` in `.env` (currently placeholders), and a `stripe listen`-forwarded webhook — see `docs/payments.md`'s rewritten runbook.

## Addendum 3 — v1 Express accounts → v2 Core Accounts (2026-09-15, hours after Addendum 2)

**Why**: real Stripe test keys landed in `.env` right after Addendum 2 shipped, and the very first live call — `POST /payment-accounts/connect` — 400'd with a real Stripe error: `Access Denied`. This platform's actual Stripe account doesn't have v1 account creation enabled at all. Checked current docs: Stripe now steers every *new* Connect integration (which this is) toward the **Accounts v2** API (`/v2/core/accounts`), with v1 Express/Standard/Custom accounts explicitly marked a "deprecated feature" for new builds — v1 stays available only via an opt-in Dashboard compatibility toggle for existing integrations. Given the choice between flipping that toggle (fast, but building on what Stripe is actively moving away from) or migrating now (the SDK already supports v2; v2 has a real Account-Links-v2 hosted-onboarding equivalent, confirmed before starting), the call was to migrate.

**What changed in `StripeProvider`** (`createConnectAccount()`/`createAccountLink()`/`getConnectAccountStatus()` only — `PaymentProvider`'s method signatures barely moved, so `PaymentAccountsService`/`PaymentAccountsController` needed almost no changes):
- `stripe.v2.core.accounts.create(...)` instead of `stripe.accounts.create({type: "express"})`.
- The **`recipient` configuration, not `merchant`** — confirmed against `Accounts.d.ts`'s own doc comments: `merchant` is for when the connected account is the merchant of record (Direct charges, or Destination charges *with* `on_behalf_of`); this codebase's destination charge never sets `on_behalf_of` (the platform is merchant of record), which is exactly the `recipient` configuration's documented case. Requests `stripe_balance.stripe_transfers` (receive the destination-charge transfer) — `stripe_balance.payouts` isn't requestable on the `recipient` configuration at creation time per the SDK's own create-params type, it's just read back later once available.
- `stripe.v2.core.accountLinks.create(...)` (Account Links v2) instead of `stripe.accountLinks.create(...)` — same `refresh_url`/`return_url` shape, `use_case: {type: "account_onboarding", account_onboarding: {configurations: ["recipient"], ...}}` instead of v1's flat `type: "account_onboarding"`.
- `getConnectAccountStatus()` now passes `include: ["configuration.recipient", "requirements"]` — v2 returns `null` for nested fields unless explicitly requested (documented behavior, confirmed in `Accounts.d.ts`). There's no single `charges_enabled`/`details_submitted` boolean under v2 — `chargesEnabled` is derived from `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === "active"`, `detailsSubmitted` from whether any `requirements.entries` still has `awaiting_action_from === "user"` (mirrors what v1's flag meant: "the merchant has done their part, what's left is Stripe's").

**Three more real validation errors, found live, not from docs** — each fixed by actually calling Stripe and reading what it said, not by guessing ahead of time:
1. `defaults.responsibilities.{fees_collector,losses_collector}` must be `"application"`, not `"stripe"`, for a `recipient`-only account — makes sense in hindsight (this account is never merchant of record, so Stripe won't let it carry Stripe-collected fees/losses the way a `merchant`-configured account would). The general v2 docs example that showed `"stripe"` was for a different (merchant-configured) case.
2. `configuration.recipient` 400s at creation without a `contact_email` — fixed by threading the *already-authenticated staff member's own email* (from the JWT, via a new `@CurrentUser()` param on `PaymentAccountsController.connect()`) through to `createConnectAccount(contactEmail)`, not by adding a new form field.
3. `configuration.recipient` also requires `identity.country` — and this platform's actual Stripe account turned out to be **UAE-registered**, which per Stripe's own restriction only lets it create UAE-based connected accounts under self-serve Connect (confirmed live: `"Connected accounts in IN cannot be created by platforms in AE"`, and separately documented under Express accounts' "Countries that don't support self-serve"). `identity.country` is hardcoded `"AE"` to match — a Stripe-platform-account constraint, not a Folkshops business-identity decision; swapping in an India-registered Stripe platform account later means changing this one line back to `"IN"`.

**Verified live this time** (not just fake-gateway tests) — real `core-api`, real Docker, real Postgres, real Stripe test-mode API, via direct HTTP calls against the running app:
- `POST /payment-accounts/connect` → `201`, returned a genuine `https://connect.stripe.com/setup/e/acct_.../...` hosted onboarding URL, with a real `acct_...` id persisted.
- `GET /payment-accounts/me` → the real account row, `live: false` (accurate — onboarding hasn't been completed by a human yet).
- `POST /payment-accounts/refresh` → `201`, successfully round-tripped the real account through `getConnectAccountStatus()` with no crash on the "nothing submitted yet" shape.
- Full test suite re-run clean after every fix: unit 33/33, integration 37/37, RLS 44/44, typecheck + lint clean.
- **Not yet verified**: actually completing Stripe's hosted onboarding as a human (filling in identity/bank details) and confirming `live` flips to `true`, and a real Checkout/webhook round trip — those still need a person to click through Stripe's real onboarding UI and a `stripe listen` webhook forward running, same as Addendum 2 already flagged.
