/** `store:{tenantId}` — the cache key for StoreController's assembled
 * `GET /storefront/store` response. Its own small file rather than living
 * in store.controller.ts, specifically so PaymentAccountsService (the one
 * thing that can currently change what that endpoint returns post-
 * creation, via refreshStatus() toggling `live`) can invalidate it
 * without importing the controller itself and creating a circular
 * dependency between the two modules. */
export function storeCacheKey(tenantId: string): string {
  return `store:${tenantId}`;
}
