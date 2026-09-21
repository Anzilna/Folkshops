import type { estypes } from "@elastic/elasticsearch";

/** Analogous to product-search.mapping.ts — see its comments. */
export const CATEGORY_SEARCH_MAPPING: { settings: estypes.IndicesIndexSettings; mappings: estypes.MappingTypeMapping } = {
  settings: { number_of_shards: 1, number_of_replicas: 0 },
  mappings: {
    dynamic: "strict",
    properties: {
      categoryId: { type: "keyword" },
      tenantId: { type: "keyword" },
      name: { type: "text", fields: { keyword: { type: "keyword" } } },
      slug: { type: "keyword" },
      description: { type: "text" },
      isActive: { type: "boolean" },
      deletedAt: { type: "date" },
      updatedAt: { type: "date" },
      lastCdcTsMs: { type: "long" },
    },
  },
};
