import { CATEGORY_SEARCH_MAPPING } from "./index-mappings/category-search.mapping";
import { ORDER_ANALYTICS_MAPPING } from "./index-mappings/order-analytics.mapping";
import { PRODUCT_SEARCH_MAPPING } from "./index-mappings/product-search.mapping";

/**
 * Alias name -> {mapping, version}. Every consumer/query in this service
 * references only the alias (e.g. "products"), never a versioned index
 * name (e.g. "products_v1") directly — AliasManagerService is the only
 * thing that knows about versions, so a future mapping change can reindex
 * (products_v1 -> products_v2) and atomically flip the alias with zero
 * changes anywhere else. See docs/decisions/0009's "Elasticsearch" section.
 */
export const INDEX_REGISTRY = {
  products: { mapping: PRODUCT_SEARCH_MAPPING, version: 1 },
  categories: { mapping: CATEGORY_SEARCH_MAPPING, version: 1 },
  order_analytics: { mapping: ORDER_ANALYTICS_MAPPING, version: 1 },
} as const;

export type IndexAlias = keyof typeof INDEX_REGISTRY;

export function versionedIndexName(alias: IndexAlias, version: number): string {
  return `${alias}_v${version}`;
}
