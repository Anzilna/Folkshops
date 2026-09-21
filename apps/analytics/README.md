# @folkshops/analytics-api

Analytics/search service — see `docs/decisions/0009-analytics-outbox-cdc-kafka.md` for the full design. A separate deployable from `core-api`, never a dumping ground for its business logic.

## Architecture

Two structurally separate Kafka consumer groups (never shared handler code):

- **CDC** (`src/kafka-consumers/cdc-consumer.service.ts`, group `analytics-cdc-consumer`) — consumes `folkshops.cdc.products`/`folkshops.cdc.categories` (Debezium's native envelope), upserts/deletes `product_search`/`category_search` documents.
- **Business events** (`src/kafka-consumers/business-event-consumer.service.ts`, group `analytics-business-event-consumer`) — consumes `folkshops.events.order`/`folkshops.events.payment`/`folkshops.events.cart` (the outbox's `BusinessEventEnvelope`), upserts `order_analytics` documents. Trusts the envelope's payload as-is, never re-derives business meaning from a row diff.

A third, independent consumer group (`src/realtime/realtime-bridge.service.ts`, group `analytics-realtime-bridge`) bridges the same business-event topics to a per-tenant Redis pub/sub channel, served to the browser as Server-Sent Events (`src/realtime/realtime.controller.ts`).

## Indexes

`products`, `categories`, `order_analytics` — all aliases over versioned indexes (`products_v1`, ...), see `src/search/alias-manager.service.ts`. Explicit, `dynamic: "strict"` mappings in `src/search/index-mappings/`.

## Endpoints

All guarded by `StaffJwtGuard` (verifies the same `fk_access_token` cookie core-api issues) — tenant is resolved exclusively via `@CurrentTenant()`, never a query param.

- `GET /analytics/revenue`
- `GET /analytics/orders`
- `GET /analytics/top-products`
- `GET /analytics/sales-over-time`
- `GET /analytics/product-performance`
- `GET /analytics/realtime/stream` (SSE)
- `GET /health`, `GET /health/kafka-lag`

## Never touches Postgres

Debezium's own `snapshot.mode: initial` (see `database/debezium/postgres-connector.json`) is what populates Elasticsearch for the first time — it emits the full existing table contents as ordinary CDC events through the same consumer/upsert path as any later change. This service has no Postgres connection of its own.
