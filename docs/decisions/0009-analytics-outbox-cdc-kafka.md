# 0009 — Analytics/search pipeline: Outbox + Debezium CDC → Kafka → Elasticsearch

## Context

This is an explicit, user-approved **phase jump**. ADR 0001 named Kafka/Debezium/Elasticsearch as later-phase infrastructure ("not started until the features that need them exist"), and CLAUDE.md's Build order puts them under Phase 5 while the project sits mid-Phase-1. The user asked for the full pipeline now anyway — shown this conflict directly, and chose to proceed, on the condition that the exception be recorded rather than silently overwriting the project's own phasing rule. See CLAUDE.md's Build order section for the pointer back here.

The ask: a merchant-admin analytics dashboard (revenue, order trends, top products, sales over time) backed by Elasticsearch, kept live via two disjoint Kafka-fed pipelines — the existing transactional outbox, and a new Debezium CDC stream off Postgres's write-ahead log.

## Why both Outbox and CDC exist — the distinction that matters most

**Outbox = "something business-meaningful happened."** An explicit, application-shaped domain event (`order.paid`, `payment.failed`), written by the one service method that knows the business rule, in the same Postgres transaction as the state change it reports. It carries a payload the application deliberately chose to include. It can never miss a decision the app made, because it *is* that decision, recorded atomically alongside it.

**CDC = "a row changed."** No opinion about why. Debezium reads the Postgres WAL directly and reports every `INSERT`/`UPDATE`/`DELETE` on the tables it's configured for, regardless of which code path caused it — a `PATCH` endpoint, a future bulk import, a one-off SQL fix, a script. For simple entities like `products`/`categories`, where "the row is the current truth" and there's no business event smaller than "the row changed," this is both the only way to catch every mutation path and the lowest-effort way to keep a read-model projection in sync.

**Why they must never be mixed** — not just different topics, but structurally different consumer code paths (see `apps/analytics/src/kafka-consumers/`): a CDC message carries a raw before/after row diff that the consumer must interpret; treating an `orders` row UPDATE as if it were a vetted `order.paid` business event would mean *re-deriving* business meaning from a database change — exactly what this ADR (and the user's spec) prohibits. `order.paid` must always come from the outbox, never be inferred from watching `orders.status` flip to `"paid"` via CDC. Both still land in Kafka, because Kafka is the one durable, replayable transport `apps/analytics` needs regardless of which side produced the message — one consumer technology, two disjoint topic namespaces (`folkshops.events.*` vs. `folkshops.cdc.*`), never a shared envelope shape.

## Why Postgres stays the source of truth, and why Elasticsearch doesn't replace the read replica

Three stores now exist for reads, each solving a different problem:
- **Postgres primary** — transactional writes, always. Anything the app must be exactly right about right now (an order's true payment state, a checkout write) reads/writes here.
- **Postgres read replica** (`DbRouter.read("eventual")`, per ADR 0005) — ordinary relational read scaling for queries that are still fundamentally relational (paginated lists, joins) but can tolerate a little staleness. Still a full, faithful copy of the same relational schema.
- **Elasticsearch** — a purpose-built, denormalized read model for search/aggregation shapes Postgres is the wrong tool for (full-text search, nested-aggregation "top products by revenue," date-histogram time series). It is never a general-purpose query engine for this app and never holds anything Postgres doesn't already hold authoritatively.

A read replica existing is not a reason to reach for Elasticsearch, and vice versa — they answer different questions. Order/payment detail pages still read Postgres through `core-api`, exactly as before this ADR; only the merchant analytics dashboard reads Elasticsearch, through the new `apps/analytics` service, never core-api.

## Why Redis isn't the analytics store

Redis keeps its three existing jobs (cache-aside for `products`/`store` per ADR 0008, BullMQ's queue backing, and now also a thin per-tenant pub/sub channel for realtime dashboard pushes — see below). It is never asked to hold the analytics dataset itself; that would just be a second, unindexed, harder-to-query copy of what Elasticsearch already holds properly.

## What was built

- **Outbox extension**: `outbox_events` gained `aggregateType`/`aggregateId` (so a stable event envelope can be built without parsing `payload`) and `kafkaPublishedAt` (an independent completion marker for the new Kafka sink, alongside the existing `dispatchedAt`/`processedAt` BullMQ tracking — see Failure modes). `apps/workers`' relay now does two things per unprocessed row instead of one: the existing BullMQ enqueue (unchanged), and a new Kafka publish to `folkshops.events.{order,payment,cart}` via `packages/events`' `BusinessEventEnvelope`. `order.paid`'s payload was enriched (it used to carry only `{orderId, paymentId}`) with `subtotalCents`/`currency`/line items, since `order_analytics` needs that detail and it must come from the outbox's own explicit payload, never be reconstructed by a consumer reading Postgres or inferring from a CDC row. A second event type, `payment.failed`, was added — the one new outbox writer beyond what existed before this ADR, since `derivePaymentTransition` already computes that transition in the same transaction.
- **CDC**: Debezium (`debezium/connect`) reads `products`/`categories` off Postgres's logical replication slot (`pgoutput`, a dedicated least-privilege `folkshops_debezium` role — `REPLICATION` login, `SELECT` only on those two tables, no `BYPASSRLS`), publishing to `folkshops.cdc.products`/`folkshops.cdc.categories`.
- **`apps/analytics`** — new NestJS service. Two structurally separate Kafka consumer groups (CDC vs. business events, never shared handler code), Elasticsearch indexing with deterministic doc IDs (`product:{tenantId}:{productId}`, etc.) so redelivery is a no-op upsert rather than a duplicate, a tenant-scoped Analytics Query API (`@CurrentTenant()` off a staff JWT — no request ever gets to specify its own `tenantId`), and a third Kafka consumer bridging `order.paid`/etc. to a per-tenant Redis pub/sub channel, served to the merchant dashboard as Server-Sent Events.
- **Elasticsearch**: `product_search`, `category_search`, `order_analytics` — explicit (`dynamic: "strict"`) mappings, never a raw copy of the Postgres tables. Alias-based versioning (`products` alias → `products_v1`) so a future mapping change can reindex without downtime.

## Failure modes

- **Kafka down when the relay tries to publish**: caught/logged, never blocks the BullMQ/notification path. The `kafkaPublishedAt` column exists specifically because, without it, a row whose BullMQ side succeeds (`processedAt` set) would never be revisited by a poll query keyed only on `processedAt` — silently dropping that event from the analytics pipeline while notifications kept working. The relay's poll query now re-attempts a row if *either* sink's completion column is still null.
- **Elasticsearch down**: a Kafka consumer's `eachMessage` handler throwing means the offset is never committed for that message — KafkaJS's default behavior blocks that partition until the handler succeeds, i.e. until ES recovers. At-least-once, self-healing, nothing lost; lag grows during the outage (surfaced via `GET /health/kafka-lag`).
- **Duplicate delivery**: handled entirely by deterministic-ID upsert — no dedup table, no idempotency key tracking needed beyond "the ID is a pure function of the entity."
- **Connector restart**: a fixed, explicit `slot.name` (`folkshops_cdc_slot`) means Postgres resumes from the slot's last confirmed LSN rather than orphaning it and re-snapshotting.
- **Replication slot growth**: bounded via `max_slot_wal_keep_size=2GB` on the `postgres` service — if the connector is down long enough to exceed that, the slot becomes invalid and needs a full re-snapshot. This is a documented dev-acceptable/prod-needs-monitoring tradeoff, not something this ADR claims to have fully solved.
- **Consumer crash**: ordinary KafkaJS consumer-group rebalancing — another instance (or the same one, restarted) picks up the abandoned partitions from the last committed offset.

## Anti-overengineering

No Kafka Streams/ksqlDB, no Flink/Spark/ClickHouse, no Kubernetes, no Zookeeper (Kafka runs in KRaft mode, single broker), no separate idempotency/dedup datastore (deterministic IDs cover it), no Grafana/Prometheus stack for the new lag/health metrics (plain JSON `/health` endpoints, matching the project's existing `HealthModule` precedent).

## What's deliberately not built

- `order.created`, `order.cancelled`, `order.refunded`, `cart.abandoned` business events — no caller exists for cancel/refund yet, and cart-abandonment detection needs scheduled-job infrastructure that doesn't exist. Their topics are already reserved in `packages/events/src/topics.ts` so adding them later is additive, not a rework. Same treatment as CLAUDE.md's own "Deliberately deferred" section.
- A merchant-facing catalog-search UI against `product_search`/`category_search` — the indices exist because the spec named them as CDC targets, but nothing in merchant-admin or the storefront consumes them yet; no UI is built against a read model with no caller.
- A generic Kafka Connect config-provider/secrets plugin — the one Debezium DB password is substituted by the one-shot registration container reading its own env var; wiring a full secrets-provider plugin for a single value would be infrastructure for appearance.
- Automated tests for `apps/analytics` beyond what Stage 14 of the implementation plan added — the real-infra (Kafka+Debezium+ES) integration tests are gated behind a separate `test:cdc` script given container startup cost, not run in the default fast suite, matching `apps/workers`' own existing "no Jest harness, verified live" posture for its newest pieces.
