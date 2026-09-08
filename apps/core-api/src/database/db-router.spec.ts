import { DbRouter } from "./db-router";
import type { Db } from "./tokens";

/**
 * Pure routing-logic tests — no real Postgres involved, primaryDb/replicaDb
 * are just distinguishable marker objects. What matters here is which
 * connection DbRouter *chose*, not what a real query returns; the actual
 * RLS-over-a-real-connection behavior is covered by
 * database/rls-tests/primary-replica-routing.rls.test.ts instead.
 */
describe("DbRouter", () => {
  const primaryDb = { marker: "primary" } as unknown as Db;
  const replicaDb = { marker: "replica" } as unknown as Db;

  function makeRouter(): DbRouter {
    return new DbRouter(primaryDb, replicaDb);
  }

  test("write() always uses the primary connection", async () => {
    const router = makeRouter();
    const seen = await router.write(async (db) => db);
    expect(seen).toBe(primaryDb);
  });

  test("write() never invokes the replica connection", async () => {
    const router = makeRouter();
    const fn = jest.fn(async (db: Db) => {
      if (db === replicaDb) throw new Error("write() must never touch the replica");
      return "ok";
    });

    await expect(router.write(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(primaryDb);
  });

  test("read('strong') always uses the primary connection", async () => {
    const router = makeRouter();
    const seen = await router.read("strong", async (db) => db);
    expect(seen).toBe(primaryDb);
  });

  test("read('eventual') uses the replica connection when it succeeds", async () => {
    const router = makeRouter();
    const seen = await router.read("eventual", async (db) => db);
    expect(seen).toBe(replicaDb);
  });

  test("read('eventual') falls back to primary when the replica read fails", async () => {
    const router = makeRouter();
    let attempts = 0;

    const seen = await router.read("eventual", async (db) => {
      attempts += 1;
      if (db === replicaDb) throw new Error("replica unavailable");
      return db;
    });

    expect(seen).toBe(primaryDb);
    expect(attempts).toBe(2); // tried replica first, then fell back to primary
  });

  test("read('eventual') fallback does not mask a primary failure", async () => {
    const router = makeRouter();
    const bothFail = async (db: Db) => {
      throw new Error(db === replicaDb ? "replica down" : "primary down too");
    };

    await expect(router.read("eventual", bothFail)).rejects.toThrow("primary down too");
  });
});
