import { Global, Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { DbRouter } from "./db-router";
import { pgSslConfig } from "./ssl";
import { DRIZZLE, PG_POOL, REPLICA_DB, REPLICA_POOL, type Db } from "./tokens";

// Re-exported so existing imports of PG_POOL/DRIZZLE/Db from
// "./database.module" keep working — the actual declarations live in
// ./tokens (see that file for why: db-router.ts needs these values
// without importing this module file, or Nest's DI container reports a
// spurious CircularDependencyException on the file-level import cycle).
export { PG_POOL, DRIZZLE, REPLICA_POOL, REPLICA_DB, type Db };

function makePool(name: string, connectionString: string | undefined): Pool {
  const pool = new Pool({ connectionString, ssl: pgSslConfig() });
  // pg emits 'error' on an idle client when the connection drops (e.g.
  // Postgres restarts). Without a listener, Node treats that as an
  // uncaught exception and kills the whole process — one DB blip should
  // degrade reads/writes through that pool, not take the API down.
  pool.on("error", (err) => {
    Logger.error(err.message, err.stack, name);
  });
  return pool;
}

/**
 * Both pools stay raw `pg`, wrapped by Drizzle rather than replaced by it.
 * RLS tenant context (SET LOCAL app.tenant_id) must be set and reset within
 * a single transaction on a single checked-out client — ORMs that abstract
 * away connection/transaction lifecycle (e.g. Prisma's pooled query engine)
 * fight that model. Drizzle's node-postgres driver doesn't: `db.transaction`
 * runs on one client end-to-end, so withTenantContext can issue `SET LOCAL`
 * inside it without fighting the query layer — true for either pool.
 *
 * Primary and replica are two independent `pg.Pool` objects always, even in
 * local dev / CI where DATABASE_PRIMARY_URL and DATABASE_REPLICA_URL point
 * at the same physical Postgres — there is no real replication locally,
 * only two connections to one database (see docs/decisions/0005).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => makePool("PrimaryPgPool", config.get<string>("DATABASE_PRIMARY_URL")),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Db => drizzle(pool, { schema }),
    },
    {
      provide: REPLICA_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => makePool("ReplicaPgPool", config.get<string>("DATABASE_REPLICA_URL")),
    },
    {
      provide: REPLICA_DB,
      inject: [REPLICA_POOL],
      useFactory: (pool: Pool): Db => drizzle(pool, { schema }),
    },
    DbRouter,
  ],
  exports: [PG_POOL, DRIZZLE, REPLICA_POOL, REPLICA_DB, DbRouter],
})
export class DatabaseModule {}
