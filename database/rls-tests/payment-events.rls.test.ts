import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";

/** Same discipline as payments.rls.test.ts / inventory.rls.test.ts:
 * connects as folkshops_app, never the superuser. No dedicated RLS test
 * exists for payment_order_lookup — it deliberately has no RLS policy at
 * all (same reasoning as membership_lookup, which also has no RLS test of
 * its own), and its schema comment/webhook integration test already cover
 * that it holds no sensitive fields. */
const DATABASE_URL =
  process.env.RLS_TEST_DATABASE_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";

const POOL_SIZE = 5;
const CONCURRENT_OPERATIONS = 60;

interface TestTenant {
  id: string;
  paymentId: string;
  eventId: string;
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
    `Payment Events RLS Test ${suffix} ${runId}`,
    `payment-events-rls-test-${suffix}-${runId}`,
  ]);
  const tenantId = tenant.rows[0].id;

  const { paymentId, eventId } = await withTenantContext(tenantId, async (client) => {
    const customer = await client.query(`INSERT INTO customers (tenant_id, phone) VALUES ($1, $2) RETURNING id`, [
      tenantId,
      `+1888${suffix}${runId.slice(0, 4)}`,
    ]);
    const order = await client.query(
      `INSERT INTO orders (tenant_id, customer_id, subtotal_cents) VALUES ($1, $2, 50000) RETURNING id`,
      [tenantId, customer.rows[0].id],
    );
    const payment = await client.query(
      `INSERT INTO payments (tenant_id, order_id, idempotency_key, amount_cents) VALUES ($1, $2, $3, 50000) RETURNING id`,
      [tenantId, order.rows[0].id, `key-${suffix}-${runId}`],
    );
    const event = await client.query(
      `INSERT INTO payment_events (tenant_id, payment_id, event_type, provider_event_id, payload) VALUES ($1, $2, 'payment.captured', $3, '{}'::jsonb) RETURNING id`,
      [tenantId, payment.rows[0].id, `evt-${suffix}-${runId}`],
    );
    return { paymentId: payment.rows[0].id, eventId: event.rows[0].id };
  });

  return { id: tenantId, paymentId, eventId };
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
        client.query(`DELETE FROM payment_events WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM payments WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM orders WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM customers WHERE tenant_id = $1`, [tenant.id]),
      ]),
    );
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
  await pool.end();
});

test("a tenant scoped to A never sees B's payment events, even under concurrent pooled connections", async () => {
  const operations = Array.from({ length: CONCURRENT_OPERATIONS }, (_, i) => {
    const scopedTo = i % 2 === 0 ? tenantA : tenantB;
    return withTenantContext(scopedTo.id, async (client) => {
      const { rows } = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM payment_events`);
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

test("no tenant context set means zero rows, not every tenant's webhook history (fail closed)", async () => {
  const { rows } = await withTenantContext(null, (client) => client.query(`SELECT tenant_id FROM payment_events`));
  expect(rows).toHaveLength(0);
});

test("inserting an event against tenant A's payment while scoped to tenant B is rejected", async () => {
  await expect(
    withTenantContext(tenantB.id, (client) =>
      client.query(
        `INSERT INTO payment_events (tenant_id, payment_id, event_type, provider_event_id, payload) VALUES ($1, $2, 'payment.captured', $3, '{}'::jsonb)`,
        [tenantA.id, tenantA.paymentId, `cross-tenant-${randomUUID()}`],
      ),
    ),
  ).rejects.toThrow();
});
