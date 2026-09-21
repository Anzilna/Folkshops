import { BUSINESS_EVENT_TOPICS, type BusinessEventEnvelope } from "@folkshops/events";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Consumer, EachMessagePayload } from "kafkajs";
import { kafka } from "../kafka/kafka-client";
import { redisPublisher } from "./redis-client";

const GROUP_ID = "analytics-realtime-bridge";

/**
 * A THIRD, independent Kafka consumer group on the same business-event
 * topics kafka-consumers/business-event-consumer.service.ts already
 * subscribes to — deliberately separate so a slow/crashed SSE bridge
 * never blocks Elasticsearch indexing, or vice versa; they're genuinely
 * independent concerns sharing only the source topic. See
 * docs/decisions/0009's realtime section.
 *
 * Publishes a thin, per-tenant message — no amounts/PII — to Redis
 * pub/sub. The dashboard re-fetches full data via the Analytics Query API
 * on receiving this signal rather than trusting anything carried on the
 * realtime channel itself. Redis here is pure pub/sub: nothing persisted,
 * no new data structure, no key outliving a connection — kept to its
 * existing roles (cache/BullMQ/pubsub), never a second analytics store.
 */
@Injectable()
export class RealtimeBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeBridgeService.name);
  private readonly consumer: Consumer = kafka.consumer({ groupId: GROUP_ID });

  async onModuleInit(): Promise<void> {
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({
        topics: [BUSINESS_EVENT_TOPICS.order, BUSINESS_EVENT_TOPICS.payment],
        fromBeginning: false, // realtime only cares about events from now on, unlike the indexing consumers
      });
      await this.consumer.run({ eachMessage: (payload) => this.handleMessage(payload) });
    } catch (err) {
      this.logger.error(`Failed to start realtime bridge: ${err instanceof Error ? err.message : err}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect().catch(() => {});
  }

  private async handleMessage({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    let envelope: BusinessEventEnvelope;
    try {
      envelope = JSON.parse(message.value.toString());
    } catch {
      return;
    }

    try {
      await redisPublisher.publish(
        `analytics:tenant:${envelope.tenantId}`,
        JSON.stringify({ eventType: envelope.eventType, aggregateId: envelope.aggregateId, occurredAt: envelope.occurredAt }),
      );
    } catch (err) {
      // Realtime is a convenience, not a durability guarantee — a failed
      // publish here never blocks the offset commit or retries; the
      // dashboard just misses one live tick, nothing is lost from the
      // Elasticsearch/analytics side which has its own independent
      // consumer group.
      this.logger.warn(`Realtime publish failed for tenant ${envelope.tenantId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
