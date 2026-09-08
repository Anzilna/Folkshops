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
