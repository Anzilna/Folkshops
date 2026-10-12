import { Controller, Get, Inject, Sse, UseGuards, type MessageEvent } from "@nestjs/common";
import type Redis from "ioredis";
import { Observable } from "rxjs";
import { REDIS_CLIENT } from "../../redis/tokens";
import { PlatformAdminJwtAuthGuard } from "../guards/platform-admin-jwt-auth.guard";
import { PlatformAdminDashboardService } from "./platform-admin-dashboard.service";
import { PLATFORM_ADMIN_DASHBOARD_CHANNEL } from "./platform-admin-realtime";

@UseGuards(PlatformAdminJwtAuthGuard)
@Controller("platform-admin/dashboard")
export class PlatformAdminDashboardController {
  constructor(
    private readonly dashboard: PlatformAdminDashboardService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  summary() {
    return this.dashboard.getSummary();
  }

  /**
   * SSE, not polling — mirrors apps/analytics' realtime.service.ts exactly:
   * a dedicated `redis.duplicate()` subscriber per connection (a Redis
   * connection in subscribe mode can't also run normal commands, so
   * sharing one across every connected admin would mix up unsubscribes),
   * carrying only a "something changed" signal. The dashboard re-fetches
   * GET /platform-admin/dashboard on receiving it rather than trusting
   * anything on the wire.
   */
  @Sse("stream")
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const client = this.redis.duplicate();

      client.subscribe(PLATFORM_ADMIN_DASHBOARD_CHANNEL).catch((err) => subscriber.error(err));
      client.on("message", (_channel, message) => {
        try {
          subscriber.next({ data: JSON.parse(message) });
        } catch {
          // malformed message — ignore rather than tear down an otherwise-healthy connection
        }
      });

      return () => {
        client.unsubscribe(PLATFORM_ADMIN_DASHBOARD_CHANNEL).finally(() => client.disconnect());
      };
    });
  }
}
