import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";

/** Same discipline as payment-accounts.rls.test.ts: connects as
 * folkshops_app, never the superuser. */
const DATABASE_URL =
  process.env.RLS_TEST_DATABASE_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";

const POOL_SIZE = 5;
const CONCURRENT_OPERATIONS = 60;

interface TestTenant {
  id: string;
  notificationId: string;
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
  const tenant = await pool.query(`INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`, [
    `Notifications RLS Test ${suffix} ${runId}`,
    `notifications-rls-test-${suffix}-${runId}`,
  ]);
  const tenantId = tenant.rows[0].id;

  const notificationId = await withTenantContext(tenantId, async (client) => {
    const row = await client.query(
      `INSERT INTO notifications (tenant_id, kind, title, body) VALUES ($1, 'order', $2, $3) RETURNING id`,
      [tenantId, `Test notification ${suffix}`, "body"],
    );
    return row.rows[0].id;
  });

  return { id: tenantId, notificationId };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: POOL_SIZE });
  tenantA = await createTestTenant("a");
  tenantB = await createTestTenant("b");
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await withTenantContext(tenant.id, (client) => client.query(`DELETE FROM notifications WHERE tenant_id = $1`, [tenant.id]));
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
  await pool.end();
});

test("a tenant scoped to A never sees B's notifications, even under concurrent pooled connections", async () => {
  const operations = Array.from({ length: CONCURRENT_OPERATIONS }, (_, i) => {
    const scopedTo = i % 2 === 0 ? tenantA : tenantB;
    return withTenantContext(scopedTo.id, async (client) => {
      const { rows } = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM notifications`);
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

test("no tenant context set means zero rows, not every tenant's notifications (fail closed)", async () => {
  const { rows } = await withTenantContext(null, (client) => client.query(`SELECT tenant_id FROM notifications`));
  expect(rows).toHaveLength(0);
});

test("marking tenant A's notification read while scoped to tenant B affects zero rows, not tenant A's row", async () => {
  const { rowCount } = await withTenantContext(tenantB.id, (client) =>
    client.query(`UPDATE notifications SET read_at = now() WHERE id = $1`, [tenantA.notificationId]),
  );
  expect(rowCount).toBe(0);

  const { rows } = await withTenantContext(tenantA.id, (client) =>
    client.query<{ read_at: string | null }>(`SELECT read_at FROM notifications WHERE id = $1`, [tenantA.notificationId]),
  );
  expect(rows[0].read_at).toBeNull();
});
