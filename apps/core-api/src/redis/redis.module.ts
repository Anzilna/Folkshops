import { Global, Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { CacheService } from "./cache.service";
import { RedisThrottlerStorage } from "./redis-throttler.storage";
import { REDIS_CLIENT } from "./tokens";

/**
 * First real Redis consumer in the codebase — the container has existed in
 * docker-compose since Phase 1 setup but nothing used it until now (rate
 * limiting needed to survive more than one pod; see docs discussion this
 * follows from). One client, shared everywhere via DI, same resilience
 * posture as the pg pools in database.module.ts: log errors, don't let a
 * Redis blip crash the whole process. lazyConnect is NOT used — a dead
 * Redis at boot should surface immediately (a loud log), not silently on
 * first use.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = new Redis(config.get<string>("REDIS_URL") ?? "redis://localhost:6379", {
          // Reconnect forever with backoff rather than giving up — Redis
          // being briefly unavailable should degrade (CacheService fails
          // open, ThrottlerStorage would reject if truly down) not crash.
          retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
        });
        client.on("error", (err) => {
          Logger.error(err.message, err.stack, "RedisClient");
        });
        return client;
      },
    },
    CacheService,
    RedisThrottlerStorage,
  ],
  exports: [REDIS_CLIENT, CacheService, RedisThrottlerStorage],
})
export class RedisModule {}
