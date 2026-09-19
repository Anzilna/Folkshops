import Redis from "ioredis";
import { env } from "./env";

// maxRetriesPerRequest: null is a hard BullMQ requirement for any
// connection handed to a Queue/Worker (it throws at construction time
// otherwise) — BullMQ does its own retry/backoff at the job level and
// needs ioredis to block indefinitely rather than give up on a single
// command. retryStrategy mirrors core-api's own redis.module.ts: reconnect
// forever with backoff, never give up outright.
export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
});

redis.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});
