import { Pool, type PoolClient } from "pg";
import { env } from "./env";

export const pool = new Pool({ connectionString: env.databasePrimaryUrl });

/**
 * Raw-`pg` equivalent of core-api's `withTenantContext` (database/tenant-context.ts)
 * — same guarantee, same reasoning, duplicated rather than imported because
 * apps/workers doesn't depend on core-api's compiled output (no shared
 * package boundary exists for this yet — see this file's own top comment
 * in outbox-events.ts about keeping this table's payload thin instead of
 * reaching across that boundary). `SET LOCAL` (transaction-scoped, via
 * `set_config(..., true)`), never a plain `SET`, so nothing leaks onto a
 * pooled connection reused by the next job.
 */
export async function withTenantContext<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
