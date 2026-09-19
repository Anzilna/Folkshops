# 0007 — Transactional outbox + BullMQ for async order-state side effects

## Context

`PaymentsService.handleWebhookEvent()` updates `orders.status` synchronously inside the Stripe webhook request. Any future side effect of that state change — a merchant notification, eventually email/SMS, Phase 3 Copilot signals — has two bad options if bolted directly onto that handler: slow it down (risking Stripe's own retry storms if a side effect throws), or risk being silently dropped if the process crashes between committing the DB write and performing the side effect (the classic dual-write problem: you cannot atomically both commit a Postgres row and, say, send an email).

This was already anticipated and named in the project's own Build order (Phase 2, "a general outbox pattern... BullMQ, notifications") and gated: merchant-admin's notification bell (`packages/ui/src/notifications.tsx`) already existed with real UI, deliberately fed only `demoNotifications()` canned data until this landed.

## The pattern: transactional outbox, relayed to BullMQ

An `outbox_events` row is written inside the **same Postgres transaction** as the real state change it reports (`PaymentsService.applyPaymentResult()` inserts one right alongside its own `orders`/`payments` updates, same `withTenantContext` transaction). That row's existence is therefore exactly as durable as the change itself — never created for a change that didn't commit, never lost once it did, regardless of whether Redis/`apps/workers` happens to be reachable at that exact moment.

`apps/workers` (previously a placeholder app) is a separate process with two parts:
- **Relay** (`relay.ts`): polls `outbox_events` for unprocessed rows every few seconds and hands each to a BullMQ queue (`outbox`).
- **Worker** (`worker.ts`): a BullMQ `Worker` consuming that queue, dispatching by event type to a handler (`handlers/order-paid.ts` is the only one today), marking the outbox row `processed_at` only once the handler actually succeeds.

`core-api` never touches Redis/BullMQ directly for this — it only ever writes the outbox row, keeping the webhook handler's own commit fast and independent of queue health.

## Why BullMQ, not a bare poll loop

A bare polling outbox (no queue library) is simpler but throws away retry/backoff/concurrency for free — every job would need its own hand-rolled retry logic. BullMQ is already the tech this project's own Build order named for this, and Redis has been running since Phase 1 (`RedisThrottlerStorage`/`CacheService` are the existing consumers) — this is a new *use* of existing infrastructure, not new infrastructure.

## Why not import core-api's Drizzle schema/DbRouter into apps/workers

No shared package boundary exists between the two apps yet (`packages/*` are still mostly placeholders). `apps/workers` duplicates a small, self-contained `withTenantContext` (raw `pg`, `SET LOCAL app.tenant_id` via `set_config`) rather than reaching across an app boundary that doesn't exist as a package. This is intentionally minimal — if a third consumer of core-api's schema ever appears, that's when extracting a shared `packages/db` earns its keep, not before.

## RLS posture

`outbox_events` is **deliberately not RLS-protected** — same reasoning as `membership_lookup`/`payment_order_lookup`: the relay has no "current tenant" the way a request handler does, it's a background process scanning across every tenant for unprocessed rows. Its `payload` is kept to non-sensitive identifiers only (IDs, not amounts/PII) by the same restraint `payment_order_lookup`'s own comment argues for.

`notifications` (what a job handler's side effect writes into) **is** RLS-protected, tenant-owned, written only via `withTenantContext` from inside a job handler — never directly by a `core-api` request handler.

## Failure modes

- **Redis down when a row is written**: the outbox row still exists in Postgres. The relay's next poll (once Redis is back) picks it up — nothing is lost, at worst delayed.
- **Relay dispatches but the process crashes before BullMQ ever runs it**: `dispatched_at < now() - interval '1 minute'` in the relay's own poll query re-picks up any row that got marked dispatched but never finished — self-healing, no manual intervention.
- **A job handler throws**: BullMQ's own retry/backoff (3 attempts, exponential, configured on the queue) retries it. `attempts`/`last_error` on the outbox row itself (not just BullMQ's internal state) make "still working on it" distinguishable from "keeps failing" by eye — the outbox row, not the BullMQ job, is the source of truth for whether the side effect actually happened.
- **A job handler succeeds but the "mark processed" update itself fails**: the relay would re-dispatch the same row after the 1-minute staleness window, and the handler (inserting a `notifications` row) would run again — this makes `order.paid`'s handler **not** strictly idempotent yet (a second notification could theoretically be created). Not fixed here; flagged for whichever event type first needs a real idempotency key on the job (e.g. `ON CONFLICT` on a natural key), same "flag, don't silently half-fix" posture as other deferred items in this codebase.

## What's built vs. not

**Built and verified live** (real Postgres, real Redis, real BullMQ — not just fake-gateway unit tests): `outbox_events`/`notifications` schema + migrations, the `order.paid` outbox write inside `PaymentsService.applyPaymentResult()`'s existing transaction, `apps/workers`' relay + worker end-to-end (confirmed by hand-inserting an outbox row and watching a real `notifications` row appear within one poll cycle), `GET /notifications`/`POST /notifications/:id/read`/`POST /notifications/read-all` (staff-auth, tenant-scoped), merchant-admin's bell wired to real data with server-persisted read state (`@folkshops/ui`'s `NotificationBell`/`AdminShell` gained optional `onMarkRead`/`onMarkAllRead` props, backward compatible — platform-admin stays on `demoNotifications()` since it passes neither).

**Not built**: any second event type (email/SMS, indexing — `apps/workers`' own `package.json` description already named these as the eventual scope), a real idempotency key on job handlers (see the failure-mode note above), automated tests for `apps/workers` itself (verified live instead — no Jest harness exists for that app yet), running `apps/workers` anywhere but a developer's own machine (no Dockerfile/compose service for it yet, matching "don't build infra before it's needed").
