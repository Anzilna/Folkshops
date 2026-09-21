import type { estypes } from "@elastic/elasticsearch";

/**
 * A purpose-built read model, not a copy of the products table — only
 * fields search/analytics actually needs. dynamic: "strict" means an
 * unmapped field is a bug the cluster refuses to silently swallow, not a
 * silently-accepted extra column (see docs/decisions/0009).
 *
 * deletedAt/isActive/status are indexed but NOT used to decide whether to
 * write the document — products are soft-deleted (deletedAt set via
 * UPDATE, never a real SQL DELETE), so the CDC consumer always upserts;
 * these fields are what the Analytics Query API filters on at query time,
 * same pattern Postgres's own read paths already use for these columns.
 */
export const PRODUCT_SEARCH_MAPPING: { settings: estypes.IndicesIndexSettings; mappings: estypes.MappingTypeMapping } = {
  settings: { number_of_shards: 1, number_of_replicas: 0 },
  mappings: {
    dynamic: "strict",
    properties: {
      productId: { type: "keyword" },
      tenantId: { type: "keyword" },
      categoryId: { type: "keyword" },
      name: { type: "text", fields: { keyword: { type: "keyword" } } },
      slug: { type: "keyword" },
      description: { type: "text" },
      priceCents: { type: "long" },
      status: { type: "keyword" },
      isActive: { type: "boolean" },
      deletedAt: { type: "date" },
      imageUrl: { type: "keyword", index: false },
      updatedAt: { type: "date" },
      // Debezium's source.ts_ms for the change this document last
      // reflects — lets the consumer discard a stale/out-of-order
      // redelivery instead of overwriting a newer state with an older
      // one. See kafka-consumers/cdc-consumer.service.ts.
      lastCdcTsMs: { type: "long" },
    },
  },
};
