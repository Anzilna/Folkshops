import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";

/**
 * Same discipline as products.rls.test.ts: connects as the app's actual
 * runtime role (folkshops_app), never the superuser. Covers both orders
 * and order_items, enabled by the same migration (0010).
 */
const DATABASE_URL =
  process.env.RLS_TEST_DATABASE_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";

const POOL_SIZE = 5;
const CONCURRENT_OPERATIONS = 60;

interface TestTenant {
  id: string;
  orderId: string;
  orderItemId: string;
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
    `Orders RLS Test ${suffix} ${runId}`,
    `orders-rls-test-${suffix}-${runId}`,
  ]);
  const tenantId = tenant.rows[0].id;
  const phone = `+1555002${suffix === "a" ? "1" : "2"}${runId.slice(0, 4)}`;

  const { order, orderItem } = await withTenantContext(tenantId, async (client) => {
    const customer = await client.query(`INSERT INTO customers (tenant_id, phone) VALUES ($1, $2) RETURNING id`, [
      tenantId,
      phone,
    ]);
    const product = await client.query(
      `INSERT INTO products (tenant_id, name, slug, price_cents) VALUES ($1, $2, $3, 1000) RETURNING id`,
      [tenantId, `Test Product ${suffix}`, `test-product-${suffix}-${runId}`],
    );
    const order = await client.query(
      `INSERT INTO orders (tenant_id, customer_id, subtotal_cents) VALUES ($1, $2, 2000) RETURNING id`,
      [tenantId, customer.rows[0].id],
    );
    const orderItem = await client.query(
      `INSERT INTO order_items (tenant_id, order_id, product_id, product_name, price_cents, quantity)
       VALUES ($1, $2, $3, 'snapshot name', 1000, 2) RETURNING id`,
      [tenantId, order.rows[0].id, product.rows[0].id],
    );
    return { order, orderItem };
  });

  return { id: tenantId, orderId: order.rows[0].id, orderItemId: orderItem.rows[0].id };
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
        client.query(`DELETE FROM order_items WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM orders WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM products WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM customers WHERE tenant_id = $1`, [tenant.id]),
      ]),
    );
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
  await pool.end();
});

test("a tenant scoped to A never sees B's orders or order items, even under concurrent pooled connections", async () => {
  const operations = Array.from({ length: CONCURRENT_OPERATIONS }, (_, i) => {
    const scopedTo = i % 2 === 0 ? tenantA : tenantB;
    return withTenantContext(scopedTo.id, async (client) => {
      const orders = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM orders`);
      const items = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM order_items`);
      return { scopedTo: scopedTo.id, seen: [...orders.rows, ...items.rows].map((r) => r.tenant_id) };
    });
  });

  const results = await Promise.all(operations);

  for (const { scopedTo, seen } of results) {
    for (const tenantId of seen) {
      expect(tenantId).toBe(scopedTo);
    }
  }
});

test("no tenant context set means zero rows for both tables, not every tenant's orders (fail closed)", async () => {
  const [orderRows, itemRows] = await withTenantContext(null, (client) =>
    Promise.all([client.query(`SELECT tenant_id FROM orders`), client.query(`SELECT tenant_id FROM order_items`)]),
  );
  expect(orderRows.rows).toHaveLength(0);
  expect(itemRows.rows).toHaveLength(0);
});

test("tenant B cannot see or cancel tenant A's order", async () => {
  const { rows } = await withTenantContext(tenantB.id, (client) =>
    client.query(`SELECT id FROM orders WHERE id = $1`, [tenantA.orderId]),
  );
  expect(rows).toHaveLength(0);

  const { rowCount } = await withTenantContext(tenantB.id, (client) =>
    client.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [tenantA.orderId]),
  );
  expect(rowCount).toBe(0);
});

test("tenant B cannot see tenant A's order item price/quantity snapshot", async () => {
  const { rows } = await withTenantContext(tenantB.id, (client) =>
    client.query(`SELECT id FROM order_items WHERE id = $1`, [tenantA.orderItemId]),
  );
  expect(rows).toHaveLength(0);
});
