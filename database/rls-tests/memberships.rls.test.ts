import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";

/**
 * Connects as the app's actual runtime role (folkshops_app), never the
 * Postgres bootstrap superuser (folkshops) — RLS is bypassed entirely for
 * superusers/BYPASSRLS roles regardless of FORCE ROW LEVEL SECURITY, so a
 * test running as superuser would pass even if isolation were completely
 * broken. This is exactly the bug this suite exists to catch (see
 * docs/decisions/0003-tenancy-rls.md).
 */
const DATABASE_URL =
  process.env.RLS_TEST_DATABASE_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";

// Small pool, many more concurrent operations than connections, so
// connections are guaranteed to be reused and interleaved across tenants —
// the exact scenario a plain (non-LOCAL) `SET` would leak across.
const POOL_SIZE = 5;
const CONCURRENT_OPERATIONS = 60;

interface TestTenant {
  id: string;
  userId: string;
  membershipId: string;
}

let pool: Pool;
let tenantA: TestTenant;
let tenantB: TestTenant;

async function withTenantContext<T>(tenantId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
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
  const tenant = await pool.query(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
    [`RLS Test ${suffix} ${runId}`, `rls-test-${suffix}-${runId}`],
  );
  const tenantId = tenant.rows[0].id;

  const user = await pool.query(
    `INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', $2) RETURNING id`,
    [`rls-test-${suffix}-${runId}@test.local`, `RLS Test User ${suffix}`],
  );
  const userId = user.rows[0].id;

  // memberships is RLS-protected: WITH CHECK requires tenant context to
  // already equal the row being inserted.
  const membership = await withTenantContext(tenantId, (client) =>
    client.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner') RETURNING id`, [
      tenantId,
      userId,
    ]),
  );

  return { id: tenantId, userId, membershipId: membership.rows[0].id };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: POOL_SIZE });
  tenantA = await createTestTenant("a");
  tenantB = await createTestTenant("b");
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await withTenantContext(tenant.id, (client) =>
      client.query(`DELETE FROM memberships WHERE tenant_id = $1`, [tenant.id]),
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [tenant.userId]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
  await pool.end();
});

test("a tenant scoped to A never sees B's rows, even under concurrent pooled connections", async () => {
  const operations = Array.from({ length: CONCURRENT_OPERATIONS }, (_, i) => {
    const scopedTo = i % 2 === 0 ? tenantA : tenantB;
    return withTenantContext(scopedTo.id, async (client) => {
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
  const { rows } = await withTenantContext(null, (client) => client.query(`SELECT tenant_id FROM memberships`));
  expect(rows).toHaveLength(0);
});

test("inserting a row for tenant A while scoped to tenant B is rejected", async () => {
  await expect(
    withTenantContext(tenantB.id, (client) =>
      client.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'staff')`, [
        tenantA.id,
        tenantA.userId,
      ]),
    ),
  ).rejects.toThrow();
});
