import { createHash } from "node:crypto";
import type { QueryProductsDto } from "./dto/query-products.dto";

/**
 * Every key/tag this module builds always starts with `tenantId` — the
 * only thing standing between one tenant's cached catalog and another's.
 * Postgres RLS has nothing to say about Redis: RLS is a database-session
 * property (`app.tenant_id` via SET LOCAL, enforced by Postgres itself on
 * every query against a tenant-owned table), and a Redis key is just a
 * string with no built-in concept of tenancy at all. A key ever built
 * here without a tenantId prefix would be a straightforward cross-tenant
 * data leak — not a defense-in-depth gap the way an RLS-adjacent app-layer
 * check would be, since nothing else stands behind it. See
 * CacheService's own comment for the same point made about invalidateTag.
 *
 * `products:{tenantId}:page:{page}:limit:{limit}:sort:{sortBy}:{sortDir}:filter:{hash}`
 * — page/limit/sort spelled out directly (small, fixed vocabularies); the
 * filter portion (status/categoryId/isActive/search — four optional,
 * freely-combinable fields) is hashed instead of interpolated raw, mainly
 * so a `search` string containing `:` or other key-unsafe characters can
 * never corrupt the key shape. Collisions are practically irrelevant here
 * (a wrong-but-real cache read, not a security issue — RLS/tenantId
 * scoping is what actually protects data, this hash just names a bucket).
 */
export function buildProductListCacheKey(tenantId: string, query: QueryProductsDto): string {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const sortBy = query.sortBy ?? "createdAt";
  // Matches common/pagination.util.ts's resolveSort() exactly — it
  // defaults to "asc" for anything other than the literal string "desc",
  // not the other way around. Confirmed live: this key-builder originally
  // assumed "desc", producing a key that never matched the one the real
  // request actually cached under, so every read looked like a permanent
  // cache miss.
  const sortDir = query.sortDir === "desc" ? "desc" : "asc";
  const filterPayload = JSON.stringify({
    status: query.status ?? null,
    categoryId: query.categoryId ?? null,
    isActive: query.isActive ?? null,
    search: query.search ?? null,
  });
  const filterHash = createHash("sha1").update(filterPayload).digest("hex").slice(0, 12);
  return `products:${tenantId}:page:${page}:limit:${limit}:sort:${sortBy}:${sortDir}:filter:${filterHash}`;
}

/** One Set per product, containing every cached list-page key that
 * product currently appears in. Invalidated (SMEMBERS -> DEL each -> DEL
 * the tag itself) whenever that exact product is updated or deleted — see
 * ProductsService.update()/delete(). Deliberately fine-grained: an update
 * to product 105 has no reason to also evict a cached page that never
 * contained 105 in the first place. */
export function productTag(tenantId: string, productId: string): string {
  return `tag:${tenantId}:product:${productId}`;
}

/**
 * Every cached list-page key ALSO gets indexed under this one tenant-wide
 * tag, in addition to its per-product tags. CREATE invalidates it because
 * a brand-new product has no per-product tag yet (it's never appeared in
 * any cached response), so the fine-grained mechanism alone cannot make an
 * already-cached "page 1, no filters" view show it.
 *
 * UPDATE also invalidates it (alongside its own fine-grained productTag)
 * — a field change can shift which *filtered* views a product belongs to
 * (e.g. status draft -> active newly qualifying for a ?status=active
 * page), and update() has no cheap way to tell whether a given write was
 * filter-relevant without diffing against the pre-update row. Previously
 * this was fine-grained only, deliberately accepting that staleness
 * window (bounded by CACHE_PRODUCTS_LIST_TTL_SECONDS); closed by treating
 * every update as tenant-wide-invalidating, at the cost of evicting every
 * cached list page for the tenant on any single product edit — deemed
 * worth it since update() is far less frequent than list() reads.
 */
export function productsAllListsTag(tenantId: string): string {
  return `tag:${tenantId}:products:all`;
}
