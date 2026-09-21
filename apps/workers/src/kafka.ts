import { Kafka, logLevel, type Producer } from "kafkajs";
import { env } from "./env";

const kafka = new Kafka({
  clientId: "folkshops-workers",
  brokers: env.kafkaBrokers,
  logLevel: logLevel.WARN,
  retry: { retries: 8, initialRetryTime: 300 },
});

// allowAutoTopicCreation: false — the five business/CDC topics are created
// up front by docker-compose's kafka-init one-shot (docs/decisions/0009);
// a producer that could silently auto-create a mistyped topic name would
// hide a real bug instead of failing loudly.
export const kafkaProducer: Producer = kafka.producer({ allowAutoTopicCreation: false });

// Lazy connect, never in a constructor/at module load (CLAUDE.md bug #15's
// lesson applied to a new external dependency) — apps/workers must keep
// running its existing BullMQ/notification path even if Kafka is
// unreachable for the entire lifetime of the process.
let connected = false;
let connecting: Promise<void> | null = null;

export async function ensureProducerConnected(): Promise<void> {
  if (connected) return;
  if (!connecting) {
    connecting = kafkaProducer
      .connect()
      .then(() => {
        connected = true;
      })
      .finally(() => {
        connecting = null;
      });
  }
  return connecting;
}
