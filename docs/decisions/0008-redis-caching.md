# 0008 — Redis cache-aside, with tag-based invalidation for product lists

## Context

`CacheService` (`src/redis/cache.service.ts`) has existed since Phase 1's Redis work but had zero active consumers — the original consumer, `ProductsService.list()`, was pulled before it ever shipped: every distinct `page`/`limit`/`sort`/filter combination produces its own cache key, and the service's only primitive was `invalidate(key)` — delete one exact key. There was no way for a product write to know which of the many cached list-page variants it might have just made stale, so a merchant editing their own product and immediately re-checking the list could see a stale cached response — a worse regression than the ~30s of DB load the cache was meant to save.

## The fix: tag-based invalidation, not a smarter single-key scheme

`CacheService` gained `addTags(cacheKey, tags[], ttlSeconds)` and `invalidateTag(tag)`, built on Redis Sets used purely as an index — never a second copy of the cached value:

```
products:{tenantId}:page:1:limit:20:...   <- the ONE actual cached response
tag:{tenantId}:product:101                <- Set: {that key above}
tag:{tenantId}:product:105                <- Set: {that key above too}
```

Adding product 105's id to a page's tags does not create a second copy of that page's response — the tag Set holds only the cache *key* (a string). Twenty tags pointing at one page still means **one** cached response, not twenty. `invalidateTag()` is `SMEMBERS tag:... ` (read exactly which keys are affected) → `DEL` each → `DEL` the tag itself — never `SCAN` or `KEYS` over the keyspace, since the Set already names precisely what to delete.

Verified live (real Redis, `FLUSHDB` then one `GET /products?limit=3`):

```
products:{tenantId}:page:1:limit:3:...   <- one real cached response
tag:{tenantId}:product:<id-1>
tag:{tenantId}:product:<id-2>
tag:{tenantId}:product:<id-3>
tag:{tenantId}:products:all
```

and a second query (`?limit=1`) showed one product's tag correctly holding *two* cache keys — the same product appearing in two different cached pages, each still stored exactly once.

## Where caching landed

**`GET /storefront/store`** (`store.controller.ts`) — cache-aside, key `store:{tenantId}`, TTL `CACHE_STORE_TTL_SECONDS` (default 300s). Hit on every anonymous storefront page load; its two inputs (tenant name, `paymentsEnabled`) change rarely. Invalidated by `PaymentAccountsService.refreshStatus()` — the one thing that currently changes `paymentsEnabled` post-creation. `tenant` itself is *not* re-fetched from this cache; `TenantResolverMiddleware`'s own per-request lookup stays deliberately uncached (auth-adjacent, see `CacheService`'s own comment) — only the response this controller assembles from an already-resolved tenant is cached.

**`GET /products`** (`ProductsService.list()`) — cache-aside + tags, key `products:{tenantId}:page:{page}:limit:{limit}:sort:{sortBy}:{sortDir}:filter:{hash}` (the four optional filter fields — status/categoryId/isActive/search — are hashed rather than interpolated raw, mainly so a `search` string can't corrupt the key shape; collisions here are a wrong-but-real cache bucket, not a security concern — tenantId scoping is what actually protects data). TTL `CACHE_PRODUCTS_LIST_TTL_SECONDS` (default 30s).

Three different invalidation triggers, because "a product changed" isn't one event:

- **create()** → `invalidateTag(products:all)` — a brand-new product has no per-product tag yet (it's never appeared in any cached response), so only the tenant-wide catch-all can make it show up in an already-cached view immediately.
- **update()** → `invalidateTag(product:{id})` **and** `invalidateTag(products:all)` — both the fine-grained tag (pages that already contained this product) and the tenant-wide tag (pages the product might newly qualify for — see the limitation below, now closed).
- **delete()** → `invalidateTag(product:{id})` only — fine-grained is *fully* correct here (removing a product only affects pages that already had it; there's no "newly qualifies for a filtered page" concern the way update has).

**Single-record reads stay uncached, unchanged** — `ProductsService.findById()`/category-by-id were already deliberately uncached before this work (see their own comments) and nothing here revisits that.

## Multi-tenant safety — why this matters even with RLS

Every key and tag this system builds starts with `tenantId` (`products-cache.ts`'s own key-builders enforce this structurally — nothing calls `redis.set`/`sadd` with a raw, unprefixed key). This is **not** redundant with Postgres RLS: RLS is a database-session property, enforced by Postgres on every query against a tenant-owned table via `SET LOCAL app.tenant_id`. Redis has no equivalent concept at all — a key is just a string, and `SMEMBERS tag:{tenantId}:product:105` can only ever return keys some code path deliberately added under that exact tenant's namespace. A key ever built without a tenantId prefix would be a straightforward cross-tenant leak, not a defense-in-depth gap the way an app-layer check backed by RLS would be. Verified directly: invalidating tenant A's product tag leaves tenant B's cached list byte-for-byte untouched (`products-cache.integration.spec.ts`).

## Filter-membership-shift limitation — closed

`update()` originally invalidated only the fine-grained per-product tag, which left a gap: a field change that shifts which *filtered* views a product belongs to (e.g. `status: draft -> active`) wouldn't evict a separately-cached `?status=active` page that didn't contain the product yet, since that page was never tagged with it. Initially accepted as bounded (30s-default TTL, catalog-browsing staleness). Closed by having `update()` also invalidate the tenant-wide tag (`invalidateTag(products:all)`, same call `create()` already made) — `update()` has no cheap way to tell whether a given write was filter-relevant without diffing against the pre-update row, so every update is now treated as potentially filter-relevant. Trade-off: any single product edit now evicts every cached list page for that tenant, not just the ones the product was already on — accepted since `update()` runs far less often than `list()` is read. Covered by a dedicated integration test (`products-cache.integration.spec.ts`: caches a `?status=active` page while a product is still `draft`, flips it to `active`, confirms the previously-uninvolved page is evicted and the next read includes the product).

## Tag cleanup on expiry

A tag Set is given the same TTL as the cache entries it indexes (`addTags`' own `ttlSeconds` parameter). If a cache entry expires naturally rather than being explicitly invalidated, its tag Set still names it — but since the Set shares that TTL, Redis reclaims the orphaned Set on its own too, rather than tag Sets accumulating forever. Deliberately not a background sweep or on-read cleanup — both real over-engineering for what TTL alone already resolves at this scale.

## Stampede protection: explicitly not built

A cache-miss stampede (many concurrent requests all missing the same cold key at once, all hitting Postgres simultaneously) matters mainly under high concurrent traffic to the same key. This runs as a single `core-api` instance today (see `docs/decisions/0005-primary-replica-routing.md`'s own "no real replica yet" framing, and CLAUDE.md's Phase 5 notes on `RedisThrottlerStorage` being pod-ready but not pod-necessary yet) — a handful of concurrent identical `SELECT`s during a 30-second cold window is well within what Postgres already handles without a lock/coalescing mechanism. Adding one now (a distributed lock, a "singleflight" in-process dedup, etc.) would be solving a problem this deployment doesn't have yet, at the cost of real complexity (lock acquisition/release/timeout semantics, another failure mode to reason about). Revisit once multiple `core-api` instances actually exist and real traffic data shows this matters.

## What's verified

- Unit: `CacheService`'s existing get/set/delete tests, unchanged (still pass — the new methods are additive, `getOrSet`/`invalidate` untouched in behavior).
- Integration (real Redis, real Postgres, real HTTP): 12 new tests in `cache.service.integration.spec.ts` (tag primitives: multiple tags on one key, `invalidateTag` deleting exactly what it should, cross-tag isolation, `getOrSetTagged` hit/miss behavior, tag TTL matching, Redis-unreachable fail-open for every new method) + 5 in `products-cache.integration.spec.ts` (one cached response per list query end-to-end through the real controller, an update evicting exactly the pages that contained it, an update closing the filter-membership-shift gap by evicting a page the product didn't previously qualify for, tenant isolation holding under real key/tag naming, create() correctly invalidating an already-cached view) + 1 in `payment-accounts.integration.spec.ts` (the store cache actually reflecting a `refreshStatus()` change immediately, not after its TTL).
- RLS suite (47/47), unit suite (33/33), full integration suite (50/50 total) — all pass, confirming this didn't regress anything it touches indirectly (`ProductsService`/`PaymentAccountsService`/`StoreController` constructors all gained a `CacheService` dependency; real DI resolves it everywhere without further wiring, since `RedisModule` is `@Global()`).
- Manually verified the real key/tag structure in Redis via `redis-cli`, live, against the running dev stack (see the worked example above).

## What's not covered

- Categories, Customers, Inventory, Orders, Notifications lists — none cached. Categories is the most natural next candidate (identical paginated/filtered shape to products); the others are staff-only, lower read volume, and in Orders' case churn too frequently via webhook-driven status updates to be worth the invalidation surface.
