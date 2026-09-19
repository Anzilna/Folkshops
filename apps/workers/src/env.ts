import { config } from "dotenv";
import path from "node:path";

// Own .env, same convention as every other app in the monorepo (core-api,
// merchant-admin, ...) — not the repo root's.
config({ path: path.resolve(__dirname, "..", ".env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required — see .env.example`);
  return value;
}

export const env = {
  databasePrimaryUrl: required("DATABASE_PRIMARY_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  outboxPollIntervalMs: Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 3000),
};
