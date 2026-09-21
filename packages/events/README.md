# @folkshops/events

Shared Kafka transport types (docs/decisions/0009-analytics-outbox-cdc-kafka.md):

- `BusinessEventEnvelope` — the stable envelope every outbox-sourced business event (`order.paid`, `payment.failed`) is published to Kafka in, by `apps/workers`' relay.
- `DebeziumChangeEvent` — Debezium's own native CDC envelope shape, kept as-is (not flattened).
- `BUSINESS_EVENT_TOPICS` / `CDC_TOPICS` / `EVENT_TYPE_TOPIC` — topic-name constants, so a topic string never gets typo'd independently in the publisher and the consumer.

Consumed by `apps/workers` (publisher) and `apps/analytics` (consumer). Ships compiled JS (`pnpm build`), not raw TS re-exported via `package.json` `exports` like `@folkshops/ui` — its consumers are plain Node processes (`tsc` + `node dist/index.js`), not a bundler that can transpile a workspace package's TypeScript source directly.
