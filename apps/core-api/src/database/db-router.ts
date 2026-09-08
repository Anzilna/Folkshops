import { Inject, Injectable, Logger } from "@nestjs/common";
import { DRIZZLE, REPLICA_DB, type Db } from "./tokens";

export type ReadConsistency = "strong" | "eventual";

/**
 * The single place business logic asks for a database connection —
 * nothing else in the app should inject PRIMARY_DB/REPLICA_DB directly.
 * Routing (which physical connection) is deliberately kept separate from
 * tenant isolation (which rows on that connection): compose the two at the
 * call site, e.g. `dbRouter.write(db => withTenantContext(db, tenantId, fn))`.
 * withTenantContext itself is unchanged by any of this — it already works
 * on whatever `Db` it's handed.
 */
@Injectable()
export class DbRouter {
  private readonly logger = new Logger(DbRouter.name);

  constructor(
    @Inject(DRIZZLE) private readonly primaryDb: Db,
    @Inject(REPLICA_DB) private readonly replicaDb: Db,
  ) {}

  /** Writes always go to primary. There is no write path through the replica. */
  async write<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return fn(this.primaryDb);
  }

  /**
   * "strong": the latest committed data is required (immediately reading
   * back a write, payment/inventory checks, anything auth-adjacent) ->
   * primary, always.
   *
   * "eventual": stale-tolerant reads that can be offloaded from primary
   * (catalog browsing, reporting) -> replica, with a fallback to primary
   * if the replica read fails for any reason. Local dev/CI have no real
   * replica, so this fallback path is exercised constantly there (the
   * "replica" pool is just a second connection to the same Postgres) but
   * has not been tested against an actual unavailable RDS Read Replica.
   *
   * Callers choose the consistency level explicitly — nothing here
   * guesses based on the query. When in doubt, callers should ask for
   * "strong", not "eventual".
   */
  async read<T>(consistency: ReadConsistency, fn: (db: Db) => Promise<T>): Promise<T> {
    if (consistency === "strong") {
      return fn(this.primaryDb);
    }

    try {
      return await fn(this.replicaDb);
    } catch (err) {
      this.logger.warn(
        `eventual read failed against replica, falling back to primary: ${err instanceof Error ? err.message : err}`,
      );
      return fn(this.primaryDb);
    }
  }
}
