# 0013 — Transactional email (Resend + React Email) and customer WhatsApp, sent only from apps/workers

## Context

Until now nothing in Folkshops sent email. Staff sign up and log in with an email address, but they never got a welcome message, and they were never told about a new order unless they happened to open merchant-admin and check the notification bell. Customers log in by phone (OTP) and have no email column, so every email here goes to **staff**.

## Decision

- **Templates are React components** in a new `packages/emails` (`@folkshops/emails`), built on `react-email` v6. Version 6 is one unified package; the old per-component `@react-email/*` packages are deprecated. All templates share one layout (`components/email-layout.tsx`: wordmark, card, footer) and a few text/button primitives. Colors are hex copies of `packages/ui`'s light theme tokens, because email clients don't support CSS variables. `pnpm --filter @folkshops/emails dev` starts react-email's preview server on port 3010, where you can iterate on a template's design using its own `PreviewProps`.
- **Resend is the vendor**, behind an `EmailProvider` interface. This is the same swap-seam as `OtpProvider`/`PaymentProvider`. When `RESEND_API_KEY` is set the worker uses `ResendEmailProvider`; when it isn't, it uses `ConsoleEmailProvider`, which logs the plain-text body, so local dev and CI need no account. In production a missing key is a boot failure, not a silent fallback.
- **Only apps/workers sends email, and only in response to the outbox** (ADR 0007). core-api never calls Resend. It writes an outbox row in the same transaction as the real change, so an email goes out if and only if that change committed. A slow or down email vendor therefore never slows down or fails an HTTP request.
- **Sending has its own BullMQ queue (`email`)**, separate from the `outbox` queue. Outbox handlers also do DB work, such as `order.paid`'s bell notification. If sending ran inline, a flaky vendor would retry the whole handler and redo that DB work. Now a failed send retries only the send: 5 attempts with exponential backoff starting at 5s, since vendor outages and rate limits usually clear up within minutes.
- **Exactly-once delivery, as far as the vendor allows.** Each email has a deterministic key: `<outboxId>-<template>[-<userId>]`. That key is used both as the BullMQ `jobId` (re-adding a job with the same id is a no-op) and as Resend's `Idempotency-Key`. So neither a retried outbox handler nor a retried send job can deliver the same email twice. BullMQ rejects `:` in custom job ids, which is why the key uses `-`.
- **Templates are rendered at send time, not enqueue time.** A job carries only the template name and its props, as plain JSON. A fix to a template therefore also applies to jobs still waiting in the queue.

## Wired callers

| Trigger (outbox event) | Written by | Email | Recipients |
| --- | --- | --- | --- |
| `merchant.registered` (new) | `AuthService.register()`, same transaction as the tenant insert | `welcome` | the new owner |
| `order.paid` (existing) | `PaymentsService.applyPaymentResult()` | `new-order` | every member of the store |
| `staff.password_reset_requested` (new) | `PasswordResetService.requestReset()` | `password-reset` | that staff user |
| `subscription.activated` / `.past_due` / `.canceled` (new) | `SubscriptionsService.handleWebhookEvent()`, only on a real status change (row locked `FOR UPDATE`) | `billing-update` | store owners |
| `payments.activated` (new) | `PaymentAccountsService.refreshStatus()`, first activation only (conditional `activated_at IS NULL` update) | `payments-live` | store owners |

### Password reset

`POST /auth/forgot-password` returns the same response whether or not the email exists. It is throttled per IP (5/min) and per email (one request per minute, checked against the outbox). It writes only `{userId}` to the outbox. **apps/workers mints the token**: it stores a SHA-256 of the token in `password_reset_tokens` and puts the raw token only in the email. So the raw token never lands in `outbox_events`, core-api, or any log. `POST /auth/reset-password` claims the token with a conditional UPDATE (single-use, 30-minute expiry, even when two requests race), sets the password, burns any other outstanding links, and revokes every staff refresh token for the user. merchant-admin gets `/forgot-password` and `/reset-password`, plus a "Forgot password?" link on `/login`. `/reset-password` stays reachable with an old session cookie. Platform admins have no reset flow; `db:bootstrap-platform-admin` remains the way in.

## Customer WhatsApp (`packages/whatsapp`)

Customers have phones, not emails, so customer updates go over WhatsApp. It uses **Meta's Cloud API directly** (no reseller markup) behind a `WhatsAppProvider` swap-seam: `MetaCloudWhatsAppProvider` when `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set, `ConsoleWhatsAppProvider` otherwise. **Every message is `console.log`ged either way.** If the credentials are missing in production, the worker logs a warning instead of refusing to boot, because WhatsApp is an opt-in extra channel and shouldn't take the email and notification workers down with it.

- **Templates live in Meta**, not in our code. Business-initiated messages must use a pre-approved template, so `templates.ts` records each template's exact body text (to paste into WhatsApp Manager) and how our data maps to its `{{n}}` placeholders. There is nothing to render.
- **Opt-in is required** by Meta's policy. `customers.whatsapp_opt_in` and `whatsapp_opt_in_at` default to false, and only the customer can turn them on: at checkout (an unticked box above "Continue to payment") or on `/account`, where the toggle saves immediately. Opt-in is checked when the message is about to be enqueued, not when the outbox row was written, so an opt-out always wins.
- **Dedupe:** Meta has no idempotency key, so the BullMQ `jobId` (`<outboxId>-<template>`) is the only layer. Errors that no retry can fix (100, 131026, 132000, 132001) fail the job immediately (`UnrecoverableError`) instead of burning retries.

| Trigger | Template | Notes |
| --- | --- | --- |
| `order.paid` | `order_confirmed` | Alongside the staff email and bell. |
| `payment.failed` | `payment_not_completed` | Sent only if the order is still `payment_failed` when the handler runs. Links to the order page, which offers "Pay now". Staff still get nothing for this event. |

**Login OTP stays on SMS** (an explicit decision). It does not go through WhatsApp; `OtpProvider` is untouched.

**Not built:** an inbound webhook from Meta (delivery/read receipts, and treating a customer's "STOP" reply as an opt-out). Until that exists, opting out happens only through `/account`.

`payment.failed` now also has a registered handler. It sends the customer WhatsApp message described below and nothing to staff. Before this, the event had been written to the outbox for Kafka (ADR 0009) but never had a BullMQ handler. Reading the code, every such row would fail with "No handler registered", never be marked processed, and be re-enqueued by the relay every minute forever.

## Deliberately not built

- **Customer emails**: customers have no email address. WhatsApp covers customer updates instead (see above).
- **Staff email verification**: sign-up doesn't confirm the address today.
- **Per-recipient opt-out / notification preferences**: there's only one member per store until staff invitations exist.
- **Bounce/complaint webhooks from Resend**: not needed until volume makes list hygiene matter.
