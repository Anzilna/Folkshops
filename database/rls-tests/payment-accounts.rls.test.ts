import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";

/** Same discipline as payments.rls.test.ts: connects as folkshops_app,
 * never the superuser. */
const DATABASE_URL =
  process.env.RLS_TEST_DATABASE_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";

const POOL_SIZE = 5;
const CONCURRENT_OPERATIONS = 60;

interface TestTenant {
  id: string;
  accountId: string;
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
    `Payment Accounts RLS Test ${suffix} ${runId}`,
    `payment-accounts-rls-test-${suffix}-${runId}`,
  ]);
  const tenantId = tenant.rows[0].id;

  const accountId = await withTenantContext(tenantId, async (client) => {
    const account = await client.query(
      `INSERT INTO payment_accounts (tenant_id, email, phone, legal_business_name, business_type, contact_name, category, subcategory, registered_address)
       VALUES ($1, $2, $3, 'Test Business', 'individual', 'Test Owner', 'ecommerce', 'ecommerce', '{}'::jsonb) RETURNING id`,
      [tenantId, `owner-${suffix}-${runId}@test.local`, `+1888${suffix}${runId.slice(0, 4)}`],
    );
    return account.rows[0].id;
  });

  return { id: tenantId, accountId };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: POOL_SIZE });
  tenantA = await createTestTenant("a");
  tenantB = await createTestTenant("b");
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await withTenantContext(tenant.id, (client) => client.query(`DELETE FROM payment_accounts WHERE tenant_id = $1`, [tenant.id]));
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
  await pool.end();
});

test("a tenant scoped to A never sees B's payment account, even under concurrent pooled connections", async () => {
  const operations = Array.from({ length: CONCURRENT_OPERATIONS }, (_, i) => {
    const scopedTo = i % 2 === 0 ? tenantA : tenantB;
    return withTenantContext(scopedTo.id, async (client) => {
      const { rows } = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM payment_accounts`);
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

test("no tenant context set means zero rows, not every tenant's payment account (fail closed)", async () => {
  const { rows } = await withTenantContext(null, (client) => client.query(`SELECT tenant_id FROM payment_accounts`));
  expect(rows).toHaveLength(0);
});

test("updating tenant A's payment account while scoped to tenant B affects zero rows, not tenant A's row", async () => {
  const { rowCount } = await withTenantContext(tenantB.id, (client) =>
    client.query(`UPDATE payment_accounts SET live = true WHERE id = $1`, [tenantA.accountId]),
  );
  expect(rowCount).toBe(0);

  const { rows } = await withTenantContext(tenantA.id, (client) =>
    client.query<{ live: boolean }>(`SELECT live FROM payment_accounts WHERE id = $1`, [tenantA.accountId]),
  );
  expect(rows[0].live).toBe(false);
});
