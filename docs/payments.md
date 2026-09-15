# Payments — local dev runbook

See `docs/decisions/0006-payment-gateway.md` for the architecture and the "why". This is the "how do I actually use it locally" doc.

## Getting Razorpay test-mode keys

1. Sign up / log in at [dashboard.razorpay.com](https://dashboard.razorpay.com) and switch to **Test Mode** (toggle, top of the dashboard).
2. Settings → API Keys → Generate Test Key. You get a `key_id` (`rzp_test_...`) and a `key_secret` — the secret is shown once, copy it immediately.
3. Settings → Webhooks → Add New Webhook. Point it at your local tunnel URL + `/payments/webhooks/razorpay` (see below), select at minimum `payment.captured` and `payment.failed`, set a webhook secret (this is a **separate** secret from `key_secret` — never reuse it).

## Local `.env`

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

`RazorpayProvider` reads these lazily via `ConfigService`, same as every other secret in this codebase — the app boots fine with them unset, a payment attempt fails with a clear 500 instead.

## Pointing a local tunnel at the webhook

`core-api` listens on `:4000` locally, not reachable from the public internet Razorpay's servers need to reach to deliver a webhook. Use a tunnel:

```bash
ngrok http 4000
```

Take the `https://<random>.ngrok-free.app` URL ngrok prints and set it as the webhook URL in the Razorpay dashboard, pointed at `/payments/webhooks/razorpay` (e.g. `https://<random>.ngrok-free.app/payments/webhooks/razorpay`). Update it every time ngrok restarts (the free tier's URL isn't stable across sessions) — or use `ngrok http 4000 --domain=<your-reserved-domain>` if you have one reserved.

## Testing a payment manually

1. `docker compose up -d` (Postgres/Redis/MinIO), `pnpm --filter @folkshops/core-api db:migrate`, `pnpm --filter @folkshops/core-api dev`, `pnpm --filter @folkshops/storefront dev`.
2. Browse a store (`nike.localhost:3000` or whichever seeded tenant), add something to the cart, "Continue to payment."
3. On the order page, click "Pay now" — Razorpay Checkout opens.
4. Use a [published test card](https://razorpay.com/docs/payments/payments/test-card-upi-details/) (as of writing, `4111 1111 1111 1111`, any future expiry, any CVV) or a test UPI id, and complete the payment.
5. The order page should redirect to `?paid=1` and show "Payment received" within a second or two (the client-side verify path) — the webhook (async, from Razorpay's servers via the tunnel) independently confirms the same thing moments later; both paths are safe to run, the webhook is authoritative if they ever disagree.

## Simulating a duplicate webhook delivery

Razorpay's dashboard: Settings → Webhooks → (your webhook) → Logs → pick a recent delivery → "Resend". This re-sends the exact same payload/signature. `payment_events.(tenantId, providerEventId)`'s unique index should make the second delivery a no-op — check `core-api`'s logs for `"Duplicate webhook delivery ... — no-op"` and confirm nothing about the order changed a second time.

## Troubleshooting a raw-body signature mismatch

The most likely real bug class here. `RazorpaySignatureGuard` computes the HMAC over `req.rawBody` — if that's ever empty/undefined, or if it's somehow been re-encoded, verification fails with a `401` even for a genuinely correctly-signed delivery. Check:

- `main.ts` still passes `{ rawBody: true }` to `NestFactory.create` (or `createNestApplication` in a test context — see `test-utils/bootstrap-app.ts`).
- No middleware ahead of the webhook route parses/re-serializes the body first (nothing in this codebase does today, but a future global middleware addition could break this silently).
- The `Content-Type` header on the incoming request is `application/json` — body-parser's raw-capture only runs for content types it's configured to parse.

## `providerEventId` — a known open question

`PaymentsService.resolveEventId()` currently falls back to a hash of `event type + payment id + created_at` when Razorpay doesn't send an explicit event-id header, since header availability wasn't confirmed against a real delivery before this shipped (see the code comment). The first time a real webhook actually arrives, check the raw headers/payload for anything like `x-razorpay-event-id` or a payload-level `id`/`event_id` field, and switch to that directly if present — it's a strictly better idempotency key than a derived hash.

## Connecting a store's Route Linked Account (required before checkout works)

A store's checkout is gated on this — `PaymentsService.initiatePayment()` rejects `/pay` with "This store hasn't set up payments yet" until it's done, and the storefront hides "Continue to payment" for the same reason.

1. In merchant-admin, go to **Settings → Payments** (`/settings/payments`) and submit the form — legal business name, business type, category/subcategory, registered address, optionally PAN/GST.
2. This calls `POST /payment-accounts`, which creates a Razorpay Linked Account (`instance.accounts.create(...)`) under your platform account and stores the returned id.
3. The account starts **not live** — Razorpay reviews every new Linked Account before it can accept payments. There's no fixed timeline for this in test mode; click **Refresh status** on the same page to re-check (`POST /payment-accounts/refresh`, which calls `instance.accounts.fetch(id)` directly).
4. Once `live` flips to `true`, checkout unlocks for that store immediately — no restart needed, both the gate check and the storefront's `paymentsEnabled` flag read the same live DB row.

If a Linked Account seems stuck pending, check the Razorpay Dashboard's Route/sub-merchant section directly (under Account & Settings, or wherever Partner sub-merchant accounts are listed for your account type) — this codebase only surfaces whatever status Razorpay reports, it can't push the review along.

## Refunds (once Slice 4 lands)

Not built yet — this section gets filled in alongside it.
