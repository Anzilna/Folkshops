import "./env";
import { pool } from "./db";
import { redis } from "./redis";
import { startRelay } from "./relay";
import { startWorker } from "./worker";

async function main() {
  await pool.query("SELECT 1"); // fail fast/loud if Postgres is unreachable at boot, not on the first job
  const worker = startWorker();
  const relayTimer = startRelay();
  console.log("[workers] relay + worker started");

  async function shutdown() {
    console.log("[workers] shutting down...");
    clearInterval(relayTimer);
    await worker.close();
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
