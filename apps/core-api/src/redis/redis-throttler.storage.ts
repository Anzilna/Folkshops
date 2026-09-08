import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import type { Redis } from "ioredis";
import { REDIS_CLIENT } from "./tokens";

/** Fails open: if Redis is unreachable, allow the request rather than 500 every throttled route until Redis recovers — same posture as CacheService. */
const UNBLOCKED_RECORD: ThrottlerStorageRecord = { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };

/**
 * Replaces @nestjs/throttler's default in-memory ThrottlerStorageService —
 * that one is a plain in-process Map, so each pod counts independently:
 * "5/min" becomes "5/min × pod count" system-wide the moment there's more
 * than one instance. This makes every pod increment the same Redis
 * counters instead, so the limit holds regardless of instance count.
 *
 * The increment+check+block sequence runs as a single Lua script, not
 * separate GET/INCR/SET calls from Node — two pods' requests arriving in
 * the same millisecond must not both read "4" and both decide they're
 * under a limit of 5, letting 2 requests through where only 1 should have.
 * Redis executes a script atomically; nothing else can interleave.
 *
 * ttl/blockDuration arrive in milliseconds (matches @nestjs/throttler's own
 * convention); the interface's returned timeToExpire/timeToBlockExpire are
 * in seconds (matches the default in-memory implementation's contract, so
 * ThrottlerGuard's own header/error-message logic doesn't need to know
 * which storage backend produced them).
 */
const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockedKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockedPttl = redis.call('PTTL', blockedKey)
if blockedPttl > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or "0")
  return {hits, redis.call('PTTL', hitsKey), 1, blockedPttl}
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttl)
end
local hitsPttl = redis.call('PTTL', hitsKey)
if hitsPttl < 0 then
  hitsPttl = ttl
end

if hits > limit then
  redis.call('SET', blockedKey, '1', 'PX', blockDuration)
  return {hits, hitsPttl, 1, blockDuration}
end

return {hits, hitsPttl, 0, 0}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // The {...} hash tag keeps both keys on the same Redis Cluster slot —
    // irrelevant on a single instance, but means this doesn't quietly break
    // if this ever runs against a clustered Redis later.
    const namespacedKey = `throttle:{${throttlerName}:${key}}`;

    try {
      const [totalHits, timeToExpireMs, isBlockedRaw, timeToBlockExpireMs] = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `${namespacedKey}:hits`,
        `${namespacedKey}:blocked`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];

      return {
        totalHits,
        timeToExpire: Math.ceil(timeToExpireMs / 1000),
        isBlocked: isBlockedRaw === 1,
        timeToBlockExpire: Math.ceil(timeToBlockExpireMs / 1000),
      };
    } catch (err) {
      this.logger.warn(
        `rate-limit check failed for ${namespacedKey}, allowing the request through: ${err instanceof Error ? err.message : err}`,
      );
      return UNBLOCKED_RECORD;
    }
  }
}
