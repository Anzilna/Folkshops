import Redis from "ioredis";

// One shared publisher client (realtime-bridge.service.ts) — matches core-api's
// RedisModule/apps/workers' redis.ts retryStrategy convention: reconnect
// forever with backoff, never give up outright. Subscriber connections are
// deliberately NOT this instance — see realtime.service.ts's own comment
// on why each SSE connection gets its own redis.duplicate().
export const redisPublisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
});

redisPublisher.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});
