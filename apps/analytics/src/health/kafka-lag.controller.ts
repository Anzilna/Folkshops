import { Controller, Get } from "@nestjs/common";
import { kafka } from "../kafka/kafka-client";

const CONSUMER_GROUPS = ["analytics-cdc-consumer", "analytics-business-event-consumer", "analytics-realtime-bridge"];

/**
 * Plain JSON, no Grafana/Prometheus stack (docs/decisions/0009's
 * anti-overengineering section) — per-group-per-topic-partition lag
 * (latest offset minus this group's committed offset). Connector health
 * itself is just `curl localhost:8083/connectors/folkshops-postgres-connector/status`
 * — Kafka Connect's own REST endpoint is the source of truth, no new code
 * needed for that half.
 */
@Controller("health/kafka-lag")
export class KafkaLagController {
  @Get()
  async lag() {
    const admin = kafka.admin();
    await admin.connect();
    try {
      const results: Record<string, unknown> = {};

      for (const groupId of CONSUMER_GROUPS) {
        try {
          const committed = await admin.fetchOffsets({ groupId });
          const perTopic: Record<string, { partition: number; committedOffset: string; latestOffset: string; lag: number }[]> = {};

          for (const { topic, partitions } of committed) {
            const latest = await admin.fetchTopicOffsets(topic);
            const latestByPartition = new Map(latest.map((p) => [p.partition, p.offset]));

            perTopic[topic] = partitions.map((p) => {
              const latestOffset = latestByPartition.get(p.partition) ?? "0";
              const committedOffset = p.offset === "-1" ? "0" : p.offset; // -1 = no committed offset yet
              return {
                partition: p.partition,
                committedOffset,
                latestOffset,
                lag: Math.max(0, Number(latestOffset) - Number(committedOffset)),
              };
            });
          }

          results[groupId] = perTopic;
        } catch (err) {
          results[groupId] = { error: err instanceof Error ? err.message : String(err) };
        }
      }

      return results;
    } finally {
      await admin.disconnect();
    }
  }
}
