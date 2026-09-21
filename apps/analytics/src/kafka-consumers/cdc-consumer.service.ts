import { CDC_TOPICS, type DebeziumChangeEvent } from "@folkshops/events";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Consumer, EachMessagePayload } from "kafkajs";
import { kafka } from "../kafka/kafka-client";
import { SearchService } from "../search/search.service";
import { mapCategoryRow, mapProductRow } from "./map-cdc-row";

const GROUP_ID = "analytics-cdc-consumer";

/**
 * CDC path only — folkshops.cdc.products/categories, Debezium's native
 * envelope ({before, after, op, source}), structurally separate from
 * business-event-consumer.service.ts (never shared handler code, per
 * docs/decisions/0009's "never mixed" requirement). Own consumer group,
 * so a slow/crashed peer never blocks the other pipeline.
 */
@Injectable()
export class CdcConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CdcConsumerService.name);
  private readonly consumer: Consumer = kafka.consumer({ groupId: GROUP_ID });

  constructor(private readonly search: SearchService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({ topics: [CDC_TOPICS.products, CDC_TOPICS.categories], fromBeginning: true });
      await this.consumer.run({ eachMessage: (payload) => this.handleMessage(payload) });
    } catch (err) {
      // Non-fatal at boot (CLAUDE.md bug #15's lesson) — Kafka being
      // unreachable when this service starts must not crash the whole
      // app. KafkaJS's own internal retry (configured in kafka-client.ts)
      // handles reconnection; this catch only stops a connect() failure
      // from throwing out of OnModuleInit.
      this.logger.error(`Failed to start CDC consumer: ${err instanceof Error ? err.message : err}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect().catch(() => {});
  }

  private async handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
    const startedAt = Date.now();
    if (!message.value) return;

    let event: DebeziumChangeEvent;
    try {
      event = JSON.parse(message.value.toString());
    } catch {
      this.logger.warn(`Malformed CDC message on ${topic} — skipping`);
      return;
    }

    const row = event.after ?? event.before;
    if (!row) {
      this.logger.warn(`CDC event on ${topic} has neither before nor after — skipping`);
      return;
    }

    const isProducts = topic === CDC_TOPICS.products;
    const alias = isProducts ? "products" : "categories";
    const entityLabel = isProducts ? "product" : "category";
    const docId = `${entityLabel}:${(row as { tenant_id: string }).tenant_id}:${(row as { id: string }).id}`;
    let outcome: "indexed" | "deleted" | "skipped" | "failed" = "skipped";

    try {
      if (event.op === "d") {
        // Real hard deletes never happen for products/categories today
        // (both are soft-deleted via UPDATE) — this branch is real,
        // correct code for a future hard-delete/GDPR-erasure job, not
        // dead code; see product-search.mapping.ts's own comment.
        await this.search.delete(alias, docId);
        outcome = "deleted";
      } else {
        const doc = isProducts
          ? mapProductRow(row as never, event.source.ts_ms)
          : mapCategoryRow(row as never, event.source.ts_ms);
        await this.search.index(alias, docId, doc);
        outcome = "indexed";
      }
    } catch (err) {
      outcome = "failed";
      // Rethrow — KafkaJS only commits the offset after eachMessage
      // resolves without throwing, so a real failure here blocks this
      // partition until Elasticsearch recovers (at-least-once,
      // self-healing, see docs/decisions/0009's Failure modes) rather than
      // silently dropping the change.
      throw err;
    } finally {
      // Structured log only — never the row/payload itself (could carry a
      // product description or other content not meant for logs).
      this.logger.log(
        JSON.stringify({
          consumer: "cdc",
          op: event.op,
          tenantId: (row as { tenant_id?: string }).tenant_id,
          index: alias,
          docId,
          durationMs: Date.now() - startedAt,
          outcome,
        }),
      );
    }
  }
}
