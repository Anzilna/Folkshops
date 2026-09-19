# Payments — local dev runbook

See `docs/decisions/0006-payment-gateway.md` for the architecture and the "why", including the Stripe migration addendum (why Razorpay Route was replaced, on 2026-09-15). This is the "how do I actually use it locally" doc.

## Getting Stripe test-mode keys

1. Sign up / log in at [dashboard.stripe.com](https://dashboard.stripe.com) — Stripe is test-mode by default for a new account, no separate toggle needed to start (a live-mode business review only gates going live later).
2. Developers → API keys → copy the **Secret key** (`sk_test_...`).
3. **One-time, non-code setup**: complete your platform's Connect profile at [dashboard.stripe.com/connect/registration](https://dashboard.stripe.com/connect/registration) — required before "Connect Stripe" (Express account + Account Links) will work at all. This is a Dashboard account setting, not an env var.
4. Webhook secret — see "Pointing a local webhook forwarder" below; the Stripe CLI generates one for you, you don't create it in the Dashboard for local dev.

## Local `.env`

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
MERCHANT_ADMIN_URL=http://localhost:3001
```

`StripeProvider` reads these lazily via `ConfigService`, same as every other secret in this codebase — the app boots fine with them unset, a payment or Connect attempt fails with a clear 500 instead. `MERCHANT_ADMIN_URL` is where `PaymentAccountsService.connect()` points Stripe's Account Link `return_url`/`refresh_url` — merchant-admin isn't per-tenant-subdomain-resolved the way storefront is, so a single fixed origin is correct here (unlike checkout, where the storefront itself supplies its own `returnUrl` per request — see `PayOrderDto`).

## Pointing a local webhook forwarder

Stripe's own CLI does this without a tunnel:

```bash
stripe login          # one-time
stripe listen --forward-to localhost:4000/payments/webhooks/stripe
```

It prints a `whsec_...` value the moment it starts — that's your `STRIPE_WEBHOOK_SECRET` for this session (a fresh one each time you run `stripe listen`, unlike a Dashboard-registered production webhook's stable secret). Leave it running in its own terminal alongside `core-api`.

## Testing a payment manually

1. `docker compose up -d` (Postgres/Redis/MinIO), `pnpm --filter @folkshops/core-api db:migrate`, `pnpm --filter @folkshops/core-api dev`, `pnpm --filter @folkshops/storefront dev`, and `stripe listen --forward-to localhost:4000/payments/webhooks/stripe` in its own terminal.
2. Browse a store (`nike.localhost:3000` or whichever seeded tenant), add something to the cart, "Continue to payment."
3. On the order page, click "Pay now" — this redirects the whole browser to Stripe's own hosted Checkout page (`checkout.stripe.com`), not a widget embedded in the storefront.
4. Use a [published test card](https://docs.stripe.com/testing#cards) (as of writing, `4242 4242 4242 4242`, any future expiry, any CVC, any postal code) and complete the payment.
5. Stripe redirects back to `/orders/<id>?paid=1`. The order won't actually show "Payment received" until the webhook (`checkout.session.completed`, delivered async via `stripe listen`) lands — check `core-api`'s log or just refresh the order page a moment later. Unlike the old Razorpay flow, there's no client-side optimistic-verify step anymore (Stripe Checkout has no callback to verify against) — the webhook is the *only* confirmation path.

## Simulating a duplicate webhook delivery

```bash
stripe events resend evt_...   # the event id from `stripe listen`'s own log line, or the Dashboard's Developers > Events list
```

`payment_events.(tenantId, providerEventId)`'s unique index should make the second delivery a no-op — check `core-api`'s logs for `"Duplicate webhook delivery ... — no-op"` and confirm nothing about the order changed a second time.

## Troubleshooting a raw-body signature mismatch

The most likely real bug class here. `StripeSignatureGuard` computes the HMAC over `req.rawBody` — if that's ever empty/undefined, or if it's somehow been re-encoded, verification fails with a `401` even for a genuinely correctly-signed delivery. Check:

- `main.ts` still passes `{ rawBody: true }` to `NestFactory.create` (or `createNestApplication` in a test context — see `test-utils/bootstrap-app.ts`).
- No middleware ahead of the webhook route parses/re-serializes the body first (nothing in this codebase does today, but a future global middleware addition could break this silently).
- The `Content-Type` header on the incoming request is `application/json` — body-parser's raw-capture only runs for content types it's configured to parse.
- You're using the `whsec_...` `stripe listen` just printed, not a stale one from a previous run — it rotates every time the CLI restarts.

## Connecting a store's Stripe account (required before checkout works)

A store's checkout is gated on this — `PaymentsService.initiatePayment()` rejects `/pay` with "This store hasn't set up payments yet" until it's done, and the storefront hides "Continue to payment" for the same reason.

1. In merchant-admin, go to **Settings → Payments** (`/settings/payments`) and click **Connect Stripe**. This calls `POST /payment-accounts/connect`, which creates a bare v2 Core Account (`stripe.v2.core.accounts.create(...)`, `recipient` configuration — see ADR 0006's Addendum 3 for why v2/recipient, not v1 Express — no business/KYC fields sent, Folkshops never collects them) and immediately redirects the browser to a Stripe-hosted onboarding URL (`stripe.v2.core.accountLinks.create(...)`).
2. Complete onboarding on Stripe's own page — business details, identity, bank account, everything, directly on `connect.stripe.com`.
3. Stripe redirects back to `/settings/payments`, which automatically re-checks status (same as clicking **Refresh status**).
4. The account starts **not live**. Once `live` (`configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === "active"`) flips to `true`, checkout unlocks for that store immediately.

If an account seems stuck, check it directly in the Stripe Dashboard (Connect → Accounts) — this codebase only surfaces whatever Stripe reports, it can't push the review along.

**If step 1 itself fails:**
- Skipping the one-time platform Connect profile setup (`dashboard.stripe.com/connect/registration`) — required before `v2/core/accounts`/`account_links` will succeed at all.
- `identity.country` in `StripeProvider.createConnectAccount()` is hardcoded to match **this platform Stripe account's own registered country** (currently `"AE"` — Stripe won't let a platform create connected accounts in a country it isn't itself allowed to serve). If you're on a different Stripe account, this may need to change — see Addendum 3.

## Refunds

Not built yet — `StripeProvider.refund()` exists (Stripe's Refunds resource, confirmed against the installed SDK) but has no caller anywhere in this codebase yet, matching the project's own "don't build without a caller" principle. This section gets filled in once a refund flow lands.
