import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";

/**
 * Same discipline as products.rls.test.ts: connects as the app's actual
 * runtime role (folkshops_app), never the superuser. Covers both carts and
 * cart_items, enabled by the same migration (0010).
 */
const DATABASE_URL =
  process.env.RLS_TEST_DATABASE_URL ?? "postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev";

const POOL_SIZE = 5;
const CONCURRENT_OPERATIONS = 60;

interface TestTenant {
  id: string;
  productId: string;
  cartId: string;
  cartItemId: string;
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
    `Cart RLS Test ${suffix} ${runId}`,
    `cart-rls-test-${suffix}-${runId}`,
  ]);
  const tenantId = tenant.rows[0].id;
  const phone = `+1555001${suffix === "a" ? "1" : "2"}${runId.slice(0, 4)}`;

  const { product, cart, cartItem } = await withTenantContext(tenantId, async (client) => {
    const customer = await client.query(`INSERT INTO customers (tenant_id, phone) VALUES ($1, $2) RETURNING id`, [
      tenantId,
      phone,
    ]);
    const product = await client.query(
      `INSERT INTO products (tenant_id, name, slug, price_cents) VALUES ($1, $2, $3, 1000) RETURNING id`,
      [tenantId, `Test Product ${suffix}`, `test-product-${suffix}-${runId}`],
    );
    const cart = await client.query(`INSERT INTO carts (tenant_id, customer_id) VALUES ($1, $2) RETURNING id`, [
      tenantId,
      customer.rows[0].id,
    ]);
    const cartItem = await client.query(
      `INSERT INTO cart_items (tenant_id, cart_id, product_id, quantity) VALUES ($1, $2, $3, 2) RETURNING id`,
      [tenantId, cart.rows[0].id, product.rows[0].id],
    );
    return { product, cart, cartItem };
  });

  return {
    id: tenantId,
    productId: product.rows[0].id,
    cartId: cart.rows[0].id,
    cartItemId: cartItem.rows[0].id,
  };
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
        client.query(`DELETE FROM cart_items WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM carts WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM products WHERE tenant_id = $1`, [tenant.id]),
        client.query(`DELETE FROM customers WHERE tenant_id = $1`, [tenant.id]),
      ]),
    );
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
  await pool.end();
});

test("a tenant scoped to A never sees B's carts or cart items, even under concurrent pooled connections", async () => {
  const operations = Array.from({ length: CONCURRENT_OPERATIONS }, (_, i) => {
    const scopedTo = i % 2 === 0 ? tenantA : tenantB;
    return withTenantContext(scopedTo.id, async (client) => {
      const carts = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM carts`);
      const items = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM cart_items`);
      return { scopedTo: scopedTo.id, seen: [...carts.rows, ...items.rows].map((r) => r.tenant_id) };
    });
  });

  const results = await Promise.all(operations);

  for (const { scopedTo, seen } of results) {
    for (const tenantId of seen) {
      expect(tenantId).toBe(scopedTo);
    }
  }
});

test("no tenant context set means zero rows for both tables, not every tenant's carts (fail closed)", async () => {
  const [cartRows, itemRows] = await withTenantContext(null, (client) =>
    Promise.all([client.query(`SELECT tenant_id FROM carts`), client.query(`SELECT tenant_id FROM cart_items`)]),
  );
  expect(cartRows.rows).toHaveLength(0);
  expect(itemRows.rows).toHaveLength(0);
});

test("tenant B cannot see or modify tenant A's cart item", async () => {
  const { rows } = await withTenantContext(tenantB.id, (client) =>
    client.query(`SELECT id FROM cart_items WHERE id = $1`, [tenantA.cartItemId]),
  );
  expect(rows).toHaveLength(0);

  const { rowCount } = await withTenantContext(tenantB.id, (client) =>
    client.query(`UPDATE cart_items SET quantity = 99 WHERE id = $1`, [tenantA.cartItemId]),
  );
  expect(rowCount).toBe(0);
});

test("inserting a cart item for tenant A's cart while scoped to tenant B is rejected", async () => {
  await expect(
    withTenantContext(tenantB.id, (client) =>
      client.query(
        `INSERT INTO cart_items (tenant_id, cart_id, product_id, quantity) VALUES ($1, $2, $3, 1)`,
        [tenantA.id, tenantA.cartId, tenantA.productId],
      ),
    ),
  ).rejects.toThrow();
});
