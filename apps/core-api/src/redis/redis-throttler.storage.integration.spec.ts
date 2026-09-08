import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { RedisThrottlerStorage } from "./redis-throttler.storage";

/**
 * Against a real Redis (the same docker-compose instance local dev and CI
 * use) — not a mock. The whole reason increment() is a Lua script instead
 * of separate GET/INCR/SET calls from Node is atomicity under concurrent
 * requests; a mocked client can't prove that, only a real one can (see
 * redis-throttler.storage.ts's own comment on why).
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let redis: Redis;
let storage: RedisThrottlerStorage;

beforeAll(() => {
  redis = new Redis(REDIS_URL);
  storage = new RedisThrottlerStorage(redis);
});

afterAll(async () => {
  await redis.quit();
});

function uniqueKey(): string {
  return `test-${randomUUID()}`;
}

test("limit enforced: requests up to the limit are allowed, the next one is blocked", async () => {
  const key = uniqueKey();
  const limit = 5;
  const ttl = 60_000;
  const blockDuration = 60_000;

  for (let i = 1; i <= limit; i++) {
    const record = await storage.increment(key, ttl, limit, blockDuration, "test");
    expect(record.isBlocked).toBe(false);
    expect(record.totalHits).toBe(i);
  }

  const overLimit = await storage.increment(key, ttl, limit, blockDuration, "test");
  expect(overLimit.isBlocked).toBe(true);
});

test("blocked requests: once blocked, subsequent calls stay blocked for blockDuration without incrementing further", async () => {
  const key = uniqueKey();
  const limit = 2;
  const ttl = 60_000;
  const blockDuration = 5_000;

  await storage.increment(key, ttl, limit, blockDuration, "test");
  await storage.increment(key, ttl, limit, blockDuration, "test");
  const blocked1 = await storage.increment(key, ttl, limit, blockDuration, "test");
  expect(blocked1.isBlocked).toBe(true);
  expect(blocked1.timeToBlockExpire).toBeGreaterThan(0);
  expect(blocked1.timeToBlockExpire).toBeLessThanOrEqual(5);

  // Calling again while still blocked must not extend/reset the block or
  // keep incrementing the hit counter — it's already blocked, full stop.
  const blocked2 = await storage.increment(key, ttl, limit, blockDuration, "test");
  expect(blocked2.isBlocked).toBe(true);
  expect(blocked2.totalHits).toBe(blocked1.totalHits);
});

test("concurrent requests: exactly `limit` of many simultaneous callers succeed, the rest are blocked", async () => {
  const key = uniqueKey();
  const limit = 10;
  const concurrency = 40;
  const ttl = 60_000;
  const blockDuration = 60_000;

  const results = await Promise.all(
    Array.from({ length: concurrency }, () => storage.increment(key, ttl, limit, blockDuration, "test")),
  );

  const allowed = results.filter((r) => !r.isBlocked);
  const blocked = results.filter((r) => r.isBlocked);

  // A race condition in a non-atomic implementation would let more than
  // `limit` requests read a stale hit count and both decide they're under
  // the limit — this is the actual thing the Lua script exists to prevent.
  expect(allowed.length).toBe(limit);
  expect(blocked.length).toBe(concurrency - limit);
});

test("Redis failure behavior: an unreachable Redis fails open (allows the request) instead of throwing", async () => {
  const deadClient = new Redis({
    host: "127.0.0.1",
    port: 1, // nothing listens here
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    connectTimeout: 300,
  });
  // Suppress the expected connection-error emission from crashing the test
  // process — ioredis requires an 'error' listener once any command is
  // attempted on a client that never connects.
  deadClient.on("error", () => {});
  const failingStorage = new RedisThrottlerStorage(deadClient);

  const record = await failingStorage.increment(uniqueKey(), 60_000, 5, 60_000, "test");
  expect(record.isBlocked).toBe(false);

  deadClient.disconnect();
});
