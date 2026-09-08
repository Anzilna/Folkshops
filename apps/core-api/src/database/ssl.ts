/**
 * RDS requires (or strongly expects) TLS; local Docker Postgres doesn't
 * use it at all. Off by default so nothing changes for local dev — set
 * DATABASE_SSL=true once DATABASE_PRIMARY_URL/DATABASE_REPLICA_URL point
 * at RDS. Shared by both the primary and replica pools (database.module.ts),
 * drizzle.config.ts, and bootstrap-app-role.ts so all four can't disagree
 * on what "SSL on" means.
 *
 * DATABASE_SSL_REJECT_UNAUTHORIZED defaults to true (validates the server
 * certificate). Only set it to "false" as a temporary, explicit opt-out —
 * it still encrypts the connection but stops validating who's on the
 * other end of it.
 */
export function pgSslConfig(): false | { rejectUnauthorized: boolean } {
  if (process.env.DATABASE_SSL !== "true") return false;
  return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" };
}
