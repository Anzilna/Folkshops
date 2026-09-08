import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";

/**
 * Same discipline as products.rls.test.ts: connects as the app's actual
 * runtime role (folkshops_app), never the superuser — otherwise this would
 * pass even if isolation were completely broken. Covers both customers and
 * otp_codes, enabled by the same migration (0008).
 */
const DATABASE_URL =
  process.env.RLS_TEST_DATABASE_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";

const POOL_SIZE = 5;
const CONCURRENT_OPERATIONS = 60;

interface TestTenant {
  id: string;
  customerId: string;
  otpId: string;
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
    `Customers RLS Test ${suffix} ${runId}`,
    `customers-rls-test-${suffix}-${runId}`,
  ]);
  const tenantId = tenant.rows[0].id;
  const phone = `+1555000${suffix === "a" ? "1" : "2"}${runId.slice(0, 4)}`;

  const { customer, otp } = await withTenantContext(tenantId, async (client) => {
    const customer = await client.query(
      `INSERT INTO customers (tenant_id, phone) VALUES ($1, $2) RETURNING id`,
      [tenantId, phone],
    );
    const otp = await client.query(
      `INSERT INTO otp_codes (tenant_id, phone, code_hash, expires_at) VALUES ($1, $2, 'x', now() + interval '5 minutes') RETURNING id`,
      [tenantId, phone],
    );
    return { customer, otp };
  });

  return { id: tenantId, customerId: customer.rows[0].id, otpId: otp.rows[0].id };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: POOL_SIZE });
  tenantA = await createTestTenant("a");
  tenantB = await createTestTenant("b");
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await withTenantContext(tenant.id, (client) =>
      Promise.all([
        client.query(`DELETE FROM otp_codes WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM customers WHERE tenant_id = $1`, [tenant.id]),
      ]),
    );
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
  await pool.end();
});

test("a tenant scoped to A never sees B's customers, even under concurrent pooled connections", async () => {
  const operations = Array.from({ length: CONCURRENT_OPERATIONS }, (_, i) => {
    const scopedTo = i % 2 === 0 ? tenantA : tenantB;
    return withTenantContext(scopedTo.id, async (client) => {
      const { rows } = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM customers`);
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

test("no tenant context set means zero rows for both tables, not every tenant's data (fail closed)", async () => {
  const [customerRows, otpRows] = await withTenantContext(null, (client) =>
    Promise.all([
      client.query(`SELECT tenant_id FROM customers`),
      client.query(`SELECT tenant_id FROM otp_codes`),
    ]),
  );
  expect(customerRows.rows).toHaveLength(0);
  expect(otpRows.rows).toHaveLength(0);
});

test("inserting a customer for tenant A while scoped to tenant B is rejected", async () => {
  await expect(
    withTenantContext(tenantB.id, (client) =>
      client.query(`INSERT INTO customers (tenant_id, phone) VALUES ($1, '+15550009999')`, [tenantA.id]),
    ),
  ).rejects.toThrow();
});

test("tenant B cannot see or consume tenant A's OTP code", async () => {
  const { rows } = await withTenantContext(tenantB.id, (client) =>
    client.query(`SELECT id FROM otp_codes WHERE id = $1`, [tenantA.otpId]),
  );
  expect(rows).toHaveLength(0);

  const { rowCount } = await withTenantContext(tenantB.id, (client) =>
    client.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [tenantA.otpId]),
  );
  expect(rowCount).toBe(0);
});
