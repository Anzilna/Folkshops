import { BUSINESS_EVENT_TOPICS, type BusinessEventEnvelope } from "@folkshops/events";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Consumer, EachMessagePayload } from "kafkajs";
import { kafka } from "../kafka/kafka-client";
import { SearchService } from "../search/search.service";
import { buildOrderAnalyticsDocId, buildOrderPaidDocument } from "./build-order-analytics-doc";

const GROUP_ID = "analytics-business-event-consumer";

/**
 * Business-event path only — folkshops.events.*, the outbox's own
 * BusinessEventEnvelope. Structurally separate from cdc-consumer.service.ts
 * (own consumer group, own class, own handler map) — trusts
 * envelope.payload as-is, never re-derives business meaning from a CDC
 * row. See docs/decisions/0009.
 */
@Injectable()
export class BusinessEventConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BusinessEventConsumerService.name);
  private readonly consumer: Consumer = kafka.consumer({ groupId: GROUP_ID });

  private readonly handlers: Record<string, (envelope: BusinessEventEnvelope) => Promise<"indexed" | "skipped">> = {
    "order.paid": (envelope) => this.indexOrderPaid(envelope),
    // Consumed (offset committed, no error) but no read model needs this
    // yet — top-products/revenue only care about paid orders. Logged as
    // "skipped", not silently dropped. A future dashboard signal (e.g. "3
    // failed payments today") would extend this, not add a new consumer.
    "payment.failed": async () => "skipped",
  };

  constructor(private readonly search: SearchService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({
        topics: [BUSINESS_EVENT_TOPICS.order, BUSINESS_EVENT_TOPICS.payment, BUSINESS_EVENT_TOPICS.cart],
        fromBeginning: true,
      });
      await this.consumer.run({ eachMessage: (payload) => this.handleMessage(payload) });
    } catch (err) {
      this.logger.error(`Failed to start business-event consumer: ${err instanceof Error ? err.message : err}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect().catch(() => {});
  }

  private async handleMessage({ message }: EachMessagePayload): Promise<void> {
    const startedAt = Date.now();
    if (!message.value) return;

    let envelope: BusinessEventEnvelope;
    try {
      envelope = JSON.parse(message.value.toString());
    } catch {
      this.logger.warn("Malformed business event message — skipping");
      return;
    }

    const handler = this.handlers[envelope.eventType];
    let outcome: "indexed" | "skipped" | "failed" = "skipped";

    try {
      if (!handler) {
        this.logger.warn(`No handler for eventType=${envelope.eventType} — skipping`);
        return;
      }
      outcome = await handler(envelope);
    } catch (err) {
      outcome = "failed";
      throw err; // same at-least-once/self-healing reasoning as the CDC consumer
    } finally {
      this.logger.log(
        JSON.stringify({
          consumer: "business-event",
          eventId: envelope.eventId,
          eventType: envelope.eventType,
          tenantId: envelope.tenantId,
          durationMs: Date.now() - startedAt,
          outcome,
        }),
      );
    }
  }

  private async indexOrderPaid(envelope: BusinessEventEnvelope): Promise<"indexed"> {
    await this.search.index("order_analytics", buildOrderAnalyticsDocId(envelope), buildOrderPaidDocument(envelope));
    return "indexed";
  }
}
