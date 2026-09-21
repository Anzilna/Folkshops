import type { estypes } from "@elastic/elasticsearch";

/**
 * Fed only by the outbox's business events (order.paid today) — never by
 * CDC. Line items are embedded as a nested field rather than a separate
 * index: order.paid's outbox payload already snapshots productName/
 * priceCents at checkout time (see PaymentsService.applyPaymentResult()),
 * so top-products/product-performance aggregations read this snapshot
 * directly instead of a second lookup against product_search — the same
 * "snapshot, not live join" philosophy order_items itself uses in
 * Postgres. See docs/decisions/0009.
 */
export const ORDER_ANALYTICS_MAPPING: { settings: estypes.IndicesIndexSettings; mappings: estypes.MappingTypeMapping } = {
  settings: { number_of_shards: 1, number_of_replicas: 0 },
  mappings: {
    dynamic: "strict",
    properties: {
      orderId: { type: "keyword" },
      tenantId: { type: "keyword" },
      customerId: { type: "keyword" },
      eventType: { type: "keyword" },
      status: { type: "keyword" },
      subtotalCents: { type: "long" },
      currency: { type: "keyword" },
      items: {
        type: "nested",
        properties: {
          productId: { type: "keyword" },
          // .keyword sub-field is what top-products' terms aggregation
          // groups by (analytics.service.ts) — a bare "text" field isn't
          // aggregatable.
          productName: { type: "text", fields: { keyword: { type: "keyword" } } },
          priceCents: { type: "long" },
          quantity: { type: "integer" },
        },
      },
      occurredAt: { type: "date" },
      // Idempotency/ordering guard, same technique as product-search's
      // lastCdcTsMs — a redelivered or out-of-order business event with an
      // occurredAt no newer than what's already stored is a no-op, never
      // overwrites newer data with older. See
      // kafka-consumers/business-event-consumer.service.ts.
      lastEventId: { type: "keyword" },
    },
  },
};
