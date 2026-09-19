import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { CacheService } from "./cache.service";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let redis: Redis;
let cache: CacheService;

beforeAll(() => {
  redis = new Redis(REDIS_URL);
  cache = new CacheService(redis);
});

afterAll(async () => {
  await redis.quit();
});

function uniqueKey(): string {
  return `test-cache:${randomUUID()}`;
}

test("cache miss: loads from source and populates the cache for next time", async () => {
  const key = uniqueKey();
  const load = jest.fn().mockResolvedValue({ id: 1, name: "widget" });

  const result = await cache.getOrSet(key, 30, load);

  expect(result).toEqual({ id: 1, name: "widget" });
  expect(load).toHaveBeenCalledTimes(1);

  const raw = await redis.get(key);
  expect(JSON.parse(raw!)).toEqual({ id: 1, name: "widget" });
});

test("cache hit: returns the cached value from Redis without calling the source", async () => {
  const key = uniqueKey();
  await redis.set(key, JSON.stringify({ id: 2, name: "gadget" }), "EX", 30);
  const load = jest.fn().mockRejectedValue(new Error("source should never be called on a cache hit"));

  const result = await cache.getOrSet(key, 30, load);

  expect(result).toEqual({ id: 2, name: "gadget" });
  expect(load).not.toHaveBeenCalled();
});

test("write → invalidation: invalidate() clears the key, next read reloads from source", async () => {
  const key = uniqueKey();
  const load = jest
    .fn()
    .mockResolvedValueOnce({ version: 1 })
    .mockResolvedValueOnce({ version: 2 });

  const first = await cache.getOrSet(key, 30, load);
  expect(first).toEqual({ version: 1 });
  expect(await redis.get(key)).not.toBeNull();

  await cache.invalidate(key);
  expect(await redis.get(key)).toBeNull();

  const second = await cache.getOrSet(key, 30, load);
  expect(second).toEqual({ version: 2 });
  expect(load).toHaveBeenCalledTimes(2);
});

test("Redis unavailable: falls back to the source on read, and doesn't throw on the failed write-through", async () => {
  const deadClient = new Redis({
    host: "127.0.0.1",
    port: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    connectTimeout: 300,
  });
  deadClient.on("error", () => {});
  const failingCache = new CacheService(deadClient);

  const load = jest.fn().mockResolvedValue({ fromDb: true });
  const result = await failingCache.getOrSet(uniqueKey(), 30, load);

  expect(result).toEqual({ fromDb: true });
  expect(load).toHaveBeenCalledTimes(1);

  deadClient.disconnect();
});

test("invalidate() on an unreachable Redis does not throw", async () => {
  const deadClient = new Redis({
    host: "127.0.0.1",
    port: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    connectTimeout: 300,
  });
  deadClient.on("error", () => {});
  const failingCache = new CacheService(deadClient);

  await expect(failingCache.invalidate(uniqueKey())).resolves.toBeUndefined();

  deadClient.disconnect();
});

function uniqueTag(): string {
  return `test-tag:${randomUUID()}`;
}

describe("tag-based invalidation (products.service.ts's own use of this)", () => {
  test("multiple tags can point to the same cache key — the key is still stored exactly once, tags are only references", async () => {
    const key = uniqueKey();
    const tagA = uniqueTag();
    const tagB = uniqueTag();
    await cache.set(key, { page: 1 }, 30);

    await cache.addTags(key, [tagA, tagB], 30);

    expect(await redis.smembers(tagA)).toEqual([key]);
    expect(await redis.smembers(tagB)).toEqual([key]);
    // One real cached response, not one copy per tag.
    expect(await redis.exists(key)).toBe(1);
    expect(JSON.parse((await redis.get(key))!)).toEqual({ page: 1 });
  });

  test("invalidateTag deletes every cache key the tag references, and the tag Set itself", async () => {
    const keyA = uniqueKey();
    const keyB = uniqueKey();
    const tag = uniqueTag();
    await cache.set(keyA, { a: true }, 30);
    await cache.set(keyB, { b: true }, 30);
    await cache.addTags(keyA, [tag], 30);
    await cache.addTags(keyB, [tag], 30);

    await cache.invalidateTag(tag);

    expect(await redis.get(keyA)).toBeNull();
    expect(await redis.get(keyB)).toBeNull();
    expect(await redis.exists(tag)).toBe(0);
  });

  test("invalidating one tag never touches a cache key that isn't tagged with it (the tenant-isolation shape products.service.ts relies on)", async () => {
    const tenantAKey = uniqueKey();
    const tenantBKey = uniqueKey();
    const tenantATag = uniqueTag();
    const tenantBTag = uniqueTag();
    await cache.set(tenantAKey, { tenant: "A" }, 30);
    await cache.set(tenantBKey, { tenant: "B" }, 30);
    await cache.addTags(tenantAKey, [tenantATag], 30);
    await cache.addTags(tenantBKey, [tenantBTag], 30);

    await cache.invalidateTag(tenantATag);

    expect(await redis.get(tenantAKey)).toBeNull();
    // Tenant B's cache key is completely untouched by tenant A's invalidation.
    expect(JSON.parse((await redis.get(tenantBKey))!)).toEqual({ tenant: "B" });
    expect(await redis.smembers(tenantBTag)).toEqual([tenantBKey]);
  });

  test("getOrSetTagged: on a miss, computes tags from the loaded value and tags the freshly-cached key", async () => {
    const key = uniqueKey();
    const tag = uniqueTag();
    const load = jest.fn().mockResolvedValue({ items: ["x", "y"] });

    const result = await cache.getOrSetTagged(key, 30, load, () => [tag]);

    expect(result).toEqual({ items: ["x", "y"] });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await redis.smembers(tag)).toEqual([key]);
  });

  test("getOrSetTagged: on a hit, never re-runs load() and never re-derives tags", async () => {
    const key = uniqueKey();
    const tag = uniqueTag();
    await cache.set(key, { cached: true }, 30);
    await cache.addTags(key, [tag], 30);
    const load = jest.fn().mockRejectedValue(new Error("source should never be called on a cache hit"));
    const tagsFor = jest.fn().mockReturnValue(["should-never-be-added"]);

    const result = await cache.getOrSetTagged(key, 30, load, tagsFor);

    expect(result).toEqual({ cached: true });
    expect(load).not.toHaveBeenCalled();
    expect(tagsFor).not.toHaveBeenCalled();
  });

  test("a tag Set is given the same TTL as the cache entries it references, so an orphaned tag cleans itself up rather than accumulating forever", async () => {
    const key = uniqueKey();
    const tag = uniqueTag();
    await cache.set(key, { x: 1 }, 30);
    await cache.addTags(key, [tag], 30);

    const ttl = await redis.ttl(tag);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  test("addTags()/invalidateTag() on an unreachable Redis do not throw — a cache outage never breaks the write it was tagging", async () => {
    const deadClient = new Redis({
      host: "127.0.0.1",
      port: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
      connectTimeout: 300,
    });
    deadClient.on("error", () => {});
    const failingCache = new CacheService(deadClient);

    await expect(failingCache.addTags(uniqueKey(), [uniqueTag()], 30)).resolves.toBeUndefined();
    await expect(failingCache.invalidateTag(uniqueTag())).resolves.toBeUndefined();

    deadClient.disconnect();
  });
});
