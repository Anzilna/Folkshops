import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * The transactional outbox — written inside the SAME Postgres transaction
 * as whatever real state change it's reporting (e.g.
 * PaymentsService.applyPaymentResult() inserts a row here right alongside
 * its own `orders`/`payments` updates, same `withTenantContext` transaction).
 * That's the entire point of the pattern: this row's existence is exactly
 * as durable as the change it describes — never created for a change that
 * didn't actually commit, never lost once it did, regardless of whether
 * Redis/apps/workers happens to be reachable at that exact moment.
 *
 * Deliberately NOT RLS-protected — same reasoning as `membership_lookup`/
 * `payment_order_lookup`, one level removed: `apps/workers`' relay has no
 * "current tenant" the way a request handler does (it's a background
 * process scanning across every tenant for unprocessed rows), so there's
 * no `app.tenant_id` to set before it even knows which rows exist. Keeps
 * `payload` to non-sensitive identifiers only (IDs, not amounts/PII) by
 * convention, the same restraint `payment_order_lookup`'s own comment
 * argues for — this table is intentionally a thin pointer ("something
 * happened, here's enough to look it up"), not a copy of the underlying
 * data. Whatever the worker does with an event (e.g. inserting into the
 * real `notifications` table) goes through `withTenantContext` at that
 * point, same as `PaymentsService.handleWebhookEvent()` already does after
 * reading `payment_order_lookup`.
 *
 * `dispatchedAt`/`attempts` exist so the relay's own poll query
 * (`processed_at IS NULL AND (dispatched_at IS NULL OR dispatched_at <
 * now() - interval '1 minute')`) can tell "never picked up yet" apart from
 * "picked up recently, still in flight" apart from "dispatched a while
 * ago and never finished — BullMQ must have dropped it or the worker
 * crashed, try again." `processedAt` is set only once the worker's own
 * side effect actually succeeds — this row, not the BullMQ job, is the
 * source of truth for "did this actually happen."
 */
export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
