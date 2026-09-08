import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "./tokens";

/**
 * Cache-aside, not read-through: callers own the invalidation trigger (see
 * ProductsService — invalidate() is called right after the write that
 * makes a cached value stale, not left to TTL alone). Fails open on any
 * Redis error — a cache outage should mean "every request falls back to
 * Postgres", not "the app is down". Never cache anything auth-adjacent,
 * tenant-resolution, or otherwise consistency-sensitive; see
 * TenantsService.findBySlug and ProductsService.findById for the documented
 * reasoning on why those specific reads stay uncached.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getOrSet<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) return JSON.parse(cached) as T;
    } catch (err) {
      this.logger.warn(`cache read failed for ${key}, falling back to source: ${err instanceof Error ? err.message : err}`);
    }

    const value = await load();

    try {
      await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      this.logger.warn(`cache write failed for ${key}: ${err instanceof Error ? err.message : err}`);
    }

    return value;
  }

  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(`cache invalidation failed for ${key}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
