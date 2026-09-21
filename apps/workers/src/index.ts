import "./env";
import { pool } from "./db";
import { ensureProducerConnected, kafkaProducer } from "./kafka";
import { redis } from "./redis";
import { startRelay } from "./relay";
import { startWorker } from "./worker";

async function main() {
  await pool.query("SELECT 1"); // fail fast/loud if Postgres is unreachable at boot, not on the first job

  // Non-fatal — Kafka being unreachable at boot must not stop the existing
  // BullMQ/notification path from starting. The relay's own poll loop
  // retries the connection lazily on its next attempt regardless.
  ensureProducerConnected().catch((err) => {
    console.error("[workers] Kafka producer failed to connect at boot, will keep retrying lazily:", err instanceof Error ? err.message : err);
  });

  const worker = startWorker();
  const relayTimer = startRelay();
  console.log("[workers] relay + worker started");

  async function shutdown() {
    console.log("[workers] shutting down...");
    clearInterval(relayTimer);
    await worker.close();
    await kafkaProducer.disconnect().catch(() => {});
    await pool.end();
    redis.disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[workers] fatal startup error:", err);
  process.exit(1);
});
