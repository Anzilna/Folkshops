import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { payments } from "./payments";
import { tenants } from "./tenants";

/**
 * Tenant-owned, RLS-enabled — one row per webhook delivery Razorpay
 * actually sends (not per logical event; a redelivered webhook after a
 * timeout is a second delivery of the *same* event, which the unique
 * index below turns into a no-op, not a second row).
 *
 * `(tenantId, providerEventId)` unique index IS the webhook idempotency
 * mechanism — PaymentsService inserts with ON CONFLICT DO NOTHING and
 * treats "no row came back" as "already processed, ack and stop" before
 * doing anything else. See that method's own comment for why this has to
 * be a DB constraint, not an app-level check-then-insert (a real race
 * between two near-simultaneous deliveries would defeat a check-then-
 * insert; it can't defeat a unique index).
 *
 * `payload` is the raw webhook body verbatim (jsonb) — an audit trail and
 * a replay source if reprocessing is ever needed, deliberately not
 * trimmed to "only the fields we use today."
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    // Nullable — a webhook whose providerOrderId can't be resolved to a
    // payment (see payment-order-lookup.ts) still gets recorded here for
    // visibility, just without a paymentId to point at.
    paymentId: uuid("payment_id").references(() => payments.id),
    provider: text("provider").notNull().default("razorpay"),
    eventType: text("event_type").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("payment_events_tenant_provider_event_unique").on(table.tenantId, table.providerEventId)],
);
