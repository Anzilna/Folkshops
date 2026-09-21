import { Injectable, Logger, type MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import { redisPublisher } from "./redis-client";

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  /**
   * Each SSE connection gets its own dedicated `ioredis.duplicate()`
   * subscriber — a single Redis connection can only ever be in
   * subscribe-mode OR issue normal commands, never both, so sharing one
   * subscriber across every connected dashboard would mean every viewer
   * gets every other tenant's channel too (subscribe is connection-wide,
   * not per-caller). One connection per stream keeps each dashboard
   * subscribed to exactly its own tenant's channel and nothing else.
   */
  subscribe(tenantId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const channel = `analytics:tenant:${tenantId}`;
      const client = redisPublisher.duplicate();

      client.subscribe(channel).catch((err) => {
        this.logger.error(`Failed to subscribe to ${channel}: ${err instanceof Error ? err.message : err}`);
        subscriber.error(err);
      });

      client.on("message", (_channel, message) => {
        try {
          subscriber.next({ data: JSON.parse(message) });
        } catch {
          // malformed message on the channel — ignore rather than tear
          // down an otherwise-healthy SSE connection over it
        }
      });

      return () => {
        client.unsubscribe(channel).finally(() => client.disconnect());
      };
    });
  }
}
