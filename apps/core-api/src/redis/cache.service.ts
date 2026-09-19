import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "./tokens";

/**
 * Cache-aside, not read-through: callers own the invalidation trigger —
 * StoreController/PaymentAccountsService call invalidate() right after a
 * write that makes `store:{tenantId}` stale, ProductsService calls
 * invalidateTag() right after a write that makes some (not necessarily
 * all) cached product-list pages stale. Nothing here is left to TTL alone
 * to fix. Fails open on any Redis error — a cache outage should mean
 * "every request falls back to Postgres", not "the app is down". Never
 * cache anything auth-adjacent, tenant-resolution, or otherwise
 * consistency-sensitive; see TenantsService.findBySlug and
 * ProductsService.findById for the documented reasoning on why those
 * specific reads stay uncached.
 *
 * Tag-based invalidation (addTags/invalidateTag/getOrSetTagged), for
 * caching *collections* whose membership can't be captured by one exact
 * key — see products.service.ts's own comment on why a plain per-key
 * cache was pulled from the product list endpoint. Mechanism, using
 * Redis Sets as an index (never a second copy of the cached response):
 *
 *   products:{tenantId}:page:1:...   <- the ONE actual cached response
 *   tag:{tenantId}:product:101       <- Set containing the key above
 *   tag:{tenantId}:product:105       <- Set containing the key above too
 *
 * Adding a product's id to a list's tags does not create a second copy of
 * that list's response — the tag Set holds only the cache *key* (a
 * string), so a page cached once still exists exactly once in Redis no
 * matter how many products' tags point at it. Invalidating one tag deletes
 * every cache key that Set names, then deletes the Set itself. Tag keys
 * always carry a tenantId (see products.service.ts's key-builder
 * functions) — SMEMBERS on tag:{tenantId}:product:105 can only ever
 * return keys some code path deliberately added under that same
 * tenantId's namespace, so invalidating tenant A's tag structurally
 * cannot touch tenant B's cached data, the same defense-in-depth posture
 * as every other tenant-scoped key in this codebase (just enforced by
 * Redis key-naming discipline here, not Postgres RLS — Redis has no
 * concept of RLS at all, so that discipline is the *only* thing keeping
 * tenants apart in this cache; a key ever built without a tenantId would
 * be a real cross-tenant leak, not a defense-in-depth belt-and-braces
 * layer the way it is in Postgres).
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      return cached === null ? null : (JSON.parse(cached) as T);
    } catch (err) {
      this.logger.warn(`cache read failed for ${key}, treating as a miss: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      this.logger.warn(`cache write failed for ${key}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(`cache delete failed for ${key}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Alias kept for the existing single-key call sites (store cache) —
   * reads more naturally than delete() at an invalidation call site. */
  async invalidate(key: string): Promise<void> {
    return this.delete(key);
  }

  async getOrSet<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await load();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Indexes `cacheKey` under each of `tags` (Redis Sets — SADD, never a
   * copy of the cached value itself). `ttlSeconds` should match (or
   * slightly exceed) the TTL the cache entry itself was written with: a
   * tag Set outliving its only member is a harmless, bounded memory leak
   * (an orphaned reference to an already-expired key — invalidateTag's own
   * SMEMBERS+DEL simply no-ops on it later), but giving the Set the same
   * expiry means Redis reclaims it on its own even if that never happens,
   * rather than tag Sets accumulating forever. This is the chosen fix for
   * "clean up tag references when a cached entry expires" — deliberately
   * not a background sweep or an on-read cleanup, both real over-
   * engineering for what TTL alone already resolves.
   */
  async addTags(cacheKey: string, tags: string[], ttlSeconds: number): Promise<void> {
    if (tags.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const tag of tags) {
        pipeline.sadd(tag, cacheKey);
        pipeline.expire(tag, ttlSeconds);
      }
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(`tagging failed for ${cacheKey}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Deletes every cache key indexed under `tag`, then the tag Set itself.
   * SMEMBERS-then-DEL, not SCAN — the Set already names exactly which keys
   * are affected, no need to search the keyspace at all (see this
   * project's own "avoid blindly deleting all Redis keys with SCAN"
   * constraint). */
  async invalidateTag(tag: string): Promise<void> {
    try {
      const keys = await this.redis.smembers(tag);
      const pipeline = this.redis.pipeline();
      if (keys.length > 0) pipeline.del(...keys);
      pipeline.del(tag);
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(`tag invalidation failed for ${tag}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** getOrSet, plus tagging the freshly-cached key on a miss — the
   * combined operation ProductsService.list() actually needs (cache the
   * page, then index it under one tag per product it contains, in one
   * call) rather than every caller re-deriving that two-step sequence by
   * hand. `tags` is a function of the loaded value, not a fixed array —
   * which products ended up on a given page (and therefore which tags
   * apply) is only known once `load()` has actually run; a plain array
   * couldn't express that. Tags are only (re-)applied on a genuine miss —
   * a cache hit means the key (and therefore its existing tags) are
   * already exactly what they were when it was written. */
  async getOrSetTagged<T>(key: string, ttlSeconds: number, load: () => Promise<T>, tagsFor: (value: T) => string[]): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await load();
    await this.set(key, value, ttlSeconds);
    await this.addTags(key, tagsFor(value), ttlSeconds);
    return value;
  }
}
