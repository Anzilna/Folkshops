import { Global, Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export const PG_POOL = Symbol("PG_POOL");
export const DRIZZLE = Symbol("DRIZZLE");

export type Db = NodePgDatabase<typeof schema>;

/**
 * The pool stays raw `pg`, wrapped by Drizzle rather than replaced by it.
 * RLS tenant context (SET LOCAL app.tenant_id) must be set and reset within
 * a single transaction on a single checked-out client — ORMs that abstract
 * away connection/transaction lifecycle (e.g. Prisma's pooled query engine)
 * fight that model. Drizzle's node-postgres driver doesn't: `db.transaction`
 * runs on one client end-to-end, so the tenancy slice can issue `SET LOCAL`
 * inside it without fighting the query layer.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.get<string>("DATABASE_URL"),
        });
        // pg emits 'error' on an idle client when the connection drops
        // (e.g. Postgres restarts). Without a listener, Node treats that
        // as an uncaught exception and kills the whole process — one DB
        // blip should degrade /health, not take the API down.
        pool.on("error", (err) => {
          Logger.error(err.message, err.stack, "PgPool");
        });
        return pool;
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Db => drizzle(pool, { schema }),
    },
  ],
  exports: [PG_POOL, DRIZZLE],
})
export class DatabaseModule {}
