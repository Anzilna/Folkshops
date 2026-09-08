import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

// Separated from database.module.ts specifically so db-router.ts (a
// provider declared *inside* that module) can import these without
// importing the module file itself — db-router.ts importing values from
// database.module.ts while database.module.ts imports DbRouter from
// db-router.ts is a circular require that trips up Nest's DI container
// (CircularDependencyException), even though there's no real circular
// *dependency* in the DI graph itself.
export const PG_POOL = Symbol("PG_POOL");
export const DRIZZLE = Symbol("DRIZZLE");
export const REPLICA_POOL = Symbol("REPLICA_POOL");
export const REPLICA_DB = Symbol("REPLICA_DB");

export type Db = NodePgDatabase<typeof schema>;
