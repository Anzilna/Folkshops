import { Kafka, logLevel } from "kafkajs";

export const kafka = new Kafka({
  clientId: "folkshops-analytics",
  brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  logLevel: logLevel.WARN,
  retry: { retries: 8, initialRetryTime: 300 },
});
