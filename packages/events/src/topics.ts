export const BUSINESS_EVENT_TOPICS = {
  order: "folkshops.events.order",
  payment: "folkshops.events.payment",
  /** Reserved — nothing publishes to this yet. cart.abandoned needs
   * scheduled-job infra that doesn't exist; see docs/decisions/0009's
   * "What's deliberately not built". Kept here so wiring it up later is
   * additive, not a rework of this map's shape. */
  cart: "folkshops.events.cart",
} as const;

export const CDC_TOPICS = {
  products: "folkshops.cdc.products",
  categories: "folkshops.cdc.categories",
} as const;

/**
 * eventType -> which business topic it belongs to. The outbox relay
 * (apps/workers) looks an eventType up here before publishing — an
 * eventType with no entry is skipped (logged, not thrown), which is what
 * lets a future outbox writer add a new eventType and only need a topic
 * mapping here, not a relay code change.
 */
export const EVENT_TYPE_TOPIC: Record<string, string> = {
  "order.paid": BUSINESS_EVENT_TOPICS.order,
  "payment.failed": BUSINESS_EVENT_TOPICS.payment,
};
