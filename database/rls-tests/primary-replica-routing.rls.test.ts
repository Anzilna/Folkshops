import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";

/**
 * Proves the RLS mechanism (see memberships.rls.test.ts) holds identically
 * regardless of which logical connection — primary or replica — a query
 * runs through. Local dev/CI have no real replica: both env vars default
 * to the SAME Postgres instance on purpose (docs/decisions/0005). This
 * file tests DATABASE ROUTING BEHAVIOR (does isolation hold through either
 * pool) — it does not, and cannot, test actual PostgreSQL streaming
 * replication, which requires a real primary+replica pair to exist at all.
 */
const PRIMARY_URL =
  process.env.RLS_TEST_PRIMARY_DATABASE_URL ??
  process.env.RLS_TEST_DATABASE_URL ??
  "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";
const REPLICA_URL =
  process.env.RLS_TEST_REPLICA_DATABASE_URL ??
  process.env.RLS_TEST_DATABASE_URL ??
  "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";

const POOL_SIZE = 5;
const CONCURRENT_OPERATIONS = 60;

interface TestTenant {
  id: string;
  userId: string;
  membershipId: string;
}

let primaryPool: Pool;
let replicaPool: Pool;
let tenantA: TestTenant;
let tenantB: TestTenant;

async function withTenantContext<T>(
  pool: Pool,
  tenantId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (tenantId) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function createTestTenant(suffix: string): Promise<TestTenant> {
  const runId = randomUUID().slice(0, 8);
  const tenant = await primaryPool.query(`INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`, [
    `RLS Routing Test ${suffix} ${runId}`,
    `rls-routing-test-${suffix}-${runId}`,
  ]);
  const tenantId = tenant.rows[0].id;

  const user = await primaryPool.query(`INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', $2) RETURNING id`, [
    `rls-routing-test-${suffix}-${runId}@test.local`,
    `RLS Routing Test User ${suffix}`,
  ]);
  const userId = user.rows[0].id;

  // Writes always go through the primary pool — mirrors DbRouter.write(),
  // which never touches the replica connection at all.
  const membership = await withTenantContext(primaryPool, tenantId, (client) =>
    client.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner') RETURNING id`, [
      tenantId,
      userId,
    ]),
  );

  return { id: tenantId, userId, membershipId: membership.rows[0].id };
}

beforeAll(async () => {
  primaryPool = new Pool({ connectionString: PRIMARY_URL, max: POOL_SIZE });
  replicaPool = new Pool({ connectionString: REPLICA_URL, max: POOL_SIZE });
  tenantA = await createTestTenant("a");
  tenantB = await createTestTenant("b");
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await withTenantContext(primaryPool, tenant.id, (client) =>
      client.query(`DELETE FROM memberships WHERE tenant_id = $1`, [tenant.id]),
    );
    await primaryPool.query(`DELETE FROM users WHERE id = $1`, [tenant.userId]);
    await primaryPool.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
  await primaryPool.end();
  await replicaPool.end();
});

describe.each([
  ["primary", () => primaryPool],
  ["replica", () => replicaPool],
])("RLS isolation through the %s connection", (_label, getPool) => {
  test("a tenant scoped to A never sees B's rows, even under concurrent pooled connections", async () => {
    const pool = getPool();
    const operations = Array.from({ length: CONCURRENT_OPERATIONS }, (_, i) => {
      const scopedTo = i % 2 === 0 ? tenantA : tenantB;
      return withTenantContext(pool, scopedTo.id, async (client) => {
        const { rows } = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM memberships`);
        return { scopedTo: scopedTo.id, seen: rows.map((r) => r.tenant_id) };
      });
    });

    const results = await Promise.all(operations);

    for (const { scopedTo, seen } of results) {
      for (const tenantId of seen) {
        expect(tenantId).toBe(scopedTo);
      }
    }
  });

  test("no tenant context set means zero rows, not every tenant's rows (fail closed)", async () => {
    const pool = getPool();
    const { rows } = await withTenantContext(pool, null, (client) => client.query(`SELECT tenant_id FROM memberships`));
    expect(rows).toHaveLength(0);
  });

  test("inserting a row for tenant A while scoped to tenant B is rejected", async () => {
    const pool = getPool();
    await expect(
      withTenantContext(pool, tenantB.id, (client) =>
        client.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'staff')`, [
          tenantA.id,
          tenantA.userId,
        ]),
      ),
    ).rejects.toThrow();
  });
});

test("primary and replica reach the same data — documented local/CI reality: same physical Postgres, not real replication", async () => {
  const { rows: viaPrimary } = await withTenantContext(primaryPool, tenantA.id, (client) =>
    client.query(`SELECT id FROM memberships WHERE id = $1`, [tenantA.membershipId]),
  );
  const { rows: viaReplica } = await withTenantContext(replicaPool, tenantA.id, (client) =>
    client.query(`SELECT id FROM memberships WHERE id = $1`, [tenantA.membershipId]),
  );
  expect(viaReplica).toEqual(viaPrimary);
});
