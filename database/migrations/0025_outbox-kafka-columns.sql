-- Hand-written, not drizzle-kit generated — a NOT NULL column added to a
-- table that may already have rows needs a backfill step drizzle-kit's
-- interactive generator can't express non-interactively, same reasoning as
-- migration 0021's own hand-written note.
ALTER TABLE "outbox_events" ADD COLUMN "aggregate_type" text NOT NULL DEFAULT 'order';
ALTER TABLE "outbox_events" ADD COLUMN "aggregate_id" uuid;

-- Backfill existing rows (today, only order.paid writes outbox_events, and
-- its payload has always carried orderId) before enforcing NOT NULL.
UPDATE "outbox_events" SET "aggregate_id" = (payload->>'orderId')::uuid WHERE "aggregate_id" IS NULL;

ALTER TABLE "outbox_events" ALTER COLUMN "aggregate_id" SET NOT NULL;
ALTER TABLE "outbox_events" ALTER COLUMN "aggregate_type" DROP DEFAULT;

ALTER TABLE "outbox_events" ADD COLUMN "kafka_published_at" timestamp with time zone;

CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");
