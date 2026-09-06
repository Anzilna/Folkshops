import { sql } from "drizzle-orm";
import type { Db } from "./database.module";

/**
 * Runs `fn` inside one Postgres transaction with `app.tenant_id` set via
 * `SET LOCAL` (transaction-scoped, cleared on commit/rollback) — never a
 * plain `SET`, which would leak onto a pooled connection reused by the next
 * unrelated request/tenant.
 *
 * Uses `set_config(..., true)` with a bound parameter rather than
 * interpolating `SET LOCAL app.tenant_id = '<value>'` into raw SQL — SET
 * does not accept bind parameters, so string interpolation there would be
 * a SQL-injection vector if tenantId were ever not a validated UUID.
 *
 * The RLS policy this feeds normalizes both "never set" (NULL) and "was
 * set earlier this session, now reset" (empty string, not NULL — a real
 * Postgres quirk on pooled connections) to fail closed identically; see
 * database/migrations/0002_fix-rls-empty-string-guc.sql.
 */
export async function withTenantContext<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
