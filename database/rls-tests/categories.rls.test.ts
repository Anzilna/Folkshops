import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";

/**
 * Same discipline as products.rls.test.ts: connects as the app's actual
 * runtime role (folkshops_app), never the superuser — otherwise this would
 * pass even if isolation were completely broken.
 */
const DATABASE_URL =
  process.env.RLS_TEST_DATABASE_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";

const POOL_SIZE = 5;
const CONCURRENT_OPERATIONS = 60;

interface TestTenant {
  id: string;
  categoryId: string;
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
    `Categories RLS Test ${suffix} ${runId}`,
    `categories-rls-test-${suffix}-${runId}`,
  ]);
  const tenantId = tenant.rows[0].id;

  const category = await withTenantContext(tenantId, (client) =>
    client.query(`INSERT INTO categories (tenant_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      tenantId,
      `Test Category ${suffix}`,
      `test-category-${suffix}-${runId}`,
    ]),
  );

  return { id: tenantId, categoryId: category.rows[0].id };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: POOL_SIZE });
  tenantA = await createTestTenant("a");
  tenantB = await createTestTenant("b");
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await withTenantContext(tenant.id, (client) =>
      client.query(`DELETE FROM categories WHERE tenant_id = $1`, [tenant.id]),
    );
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
  await pool.end();
});

test("a tenant scoped to A never sees B's categories, even under concurrent pooled connections", async () => {
  const operations = Array.from({ length: CONCURRENT_OPERATIONS }, (_, i) => {
    const scopedTo = i % 2 === 0 ? tenantA : tenantB;
    return withTenantContext(scopedTo.id, async (client) => {
      const { rows } = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM categories`);
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

test("no tenant context set means zero rows, not every tenant's categories (fail closed)", async () => {
  const { rows } = await withTenantContext(null, (client) => client.query(`SELECT tenant_id FROM categories`));
  expect(rows).toHaveLength(0);
});

test("inserting a category for tenant A while scoped to tenant B is rejected", async () => {
  await expect(
    withTenantContext(tenantB.id, (client) =>
      client.query(`INSERT INTO categories (tenant_id, name, slug) VALUES ($1, 'x', 'x')`, [tenantA.id]),
    ),
  ).rejects.toThrow();
});

test("updating tenant A's category while scoped to tenant B affects zero rows, not tenant A's row", async () => {
  const { rowCount } = await withTenantContext(tenantB.id, (client) =>
    client.query(`UPDATE categories SET name = 'hijacked' WHERE id = $1`, [tenantA.categoryId]),
  );
  expect(rowCount).toBe(0);

  const { rows } = await withTenantContext(tenantA.id, (client) =>
    client.query<{ name: string }>(`SELECT name FROM categories WHERE id = $1`, [tenantA.categoryId]),
  );
  expect(rows[0].name).toBe("Test Category a");
});
