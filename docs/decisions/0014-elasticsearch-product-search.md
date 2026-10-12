# 0014 — Product search via Elasticsearch (core-api), Postgres stays authoritative

## Context

Both search boxes (the storefront's `/?q=` and merchant-admin's Products table) called `GET /products?search=`, which ran `ILIKE '%term%'` on `products.name`. That gave no relevance ranking, no typo tolerance, and no matching on the description. Meanwhile ADR 0009 had already built a `products` Elasticsearch index, kept in sync by Debezium CDC, which nothing read.

## Decision

`ProductsService.list()` (and `exportCsv()`) ask **`ProductSearchService`** (`apps/core-api/src/search/`) for matching product ids whenever `search` is set:

- **Query:** a `multi_match` on `name^3` + `description` with `fuzziness: "AUTO"` (typos like "jakcet" → "jacket"), plus a `match_phrase_prefix` on `name` so a partial word like "lin" still finds "Linen…", as ILIKE did. Filtered by `tenantId`, `deletedAt` missing, and the same `status`/`categoryId`/`isActive` filters as the request. Returns at most 500 ids.
- **Elasticsearch only proposes ids; Postgres decides.** The ids become `id IN (...)` in the normal Drizzle query, which still applies RLS and every filter. So an index that lags a few seconds behind (it's fed by CDC) can delay a brand-new product appearing in search, but can never surface a deleted, inactive, or other store's product.
- **Ordering:** a search with no `sortBy` is ranked by relevance; ordering and paging happen in memory over at most 500 rows. An explicit `sortBy` (merchant-admin's column headers) still wins and is applied to the matched rows. The storefront stops sending `sortBy` when there's a search term.
- **Fails open:** if `ELASTICSEARCH_URL` is unset, the cluster is down, or a request takes longer than 1.5s, the result is `null` and the old ILIKE runs. The client is built lazily (bug #15).

**Why core-api and not apps/analytics:** the storefront is anonymous and its store comes from the hostname. core-api already resolves that; apps/analytics only accepts staff JWTs.

## Indexing changes (apps/analytics)

- **Descriptions are indexed as plain text** (`description-to-text.ts`). Editor.js JSON is reduced to its visible text, so "blocks", "paragraph" and "version" no longer match every edited product.
- **Fixed: CDC hard deletes never removed documents.** A delete event's `before` contains only the primary key (default `REPLICA IDENTITY`), so the composite doc id was built as `product::<id>`, the delete 404'd silently, and the real document stayed. `db:seed-demo` and integration-test teardown both hard-delete, so about 200 stale product documents and 10 stale category documents had built up. Deletes now go through `deleteByField` (`productId`/`categoryId`, which are globally unique UUIDs). The stale documents were cleaned out once, by hand.
- Separately, none of the 23 current categories were in the index (cause not established). They were re-synced as below.

## Re-syncing the index

There's no reindex job. Touch the rows and CDC re-sends them all:

```sql
UPDATE products   SET updated_at = updated_at;
UPDATE categories SET updated_at = updated_at;
```

No data changes. Each row produces a change event, which apps/analytics re-indexes with the current mapping code.

## Not built

- No mid-word substring match: "hirt" no longer finds "shirt" (ILIKE did). Prefixes and typos are covered.
- No facets ("Jackets (16)") or highlighting, and no search on categories.
- No automated test of the Elasticsearch path: CI has no Elasticsearch, so the integration suite only covers the fallback. It was verified live against the real cluster (typos, multi-word ranking, prefix, description terms, fallback with Elasticsearch stopped, storefront in a browser).
