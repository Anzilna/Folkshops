/**
 * Fills one store with enough realistic-looking data to exercise the admin
 * tables properly (pagination past page 1, sorting, status filters, search)
 * — a store with three products can't show whether any of that works.
 *
 * Direct SQL as the app's own runtime role (folkshops_app), with
 * app.tenant_id set via set_config exactly like withTenantContext does, so
 * every insert goes through RLS the same way the API's would. Re-runnable:
 * an existing store with the same slug has its data wiped and reseeded.
 *
 * Usage (all optional, defaults shown):
 *   SEED_TENANT_SLUG=demo SEED_TENANT_NAME="Demo Threads" \
 *   SEED_OWNER_EMAIL=owner@demo.test SEED_OWNER_PASSWORD='Password123!' \
 *   SEED_PRODUCTS=180 SEED_CUSTOMERS=75 SEED_ORDERS=120 \
 *   pnpm --filter @folkshops/core-api db:seed-demo
 *
 * Log in to merchant-admin with the slug + owner email + password above.
 * Dev only — never point this at a real database.
 */
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import { pgSslConfig } from "../src/database/ssl";

const slug = process.env.SEED_TENANT_SLUG ?? "demo";
const tenantName = process.env.SEED_TENANT_NAME ?? "Demo Threads";
const ownerEmail = process.env.SEED_OWNER_EMAIL ?? `owner@${slug}.test`;
const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "Password123!";
const PRODUCTS = Number(process.env.SEED_PRODUCTS ?? 180);
const CUSTOMERS = Number(process.env.SEED_CUSTOMERS ?? 75);
const ORDERS = Number(process.env.SEED_ORDERS ?? 120);

// Deterministic PRNG so two runs produce the same store — makes "why does
// page 3 look different" a non-question when comparing screenshots.
let seed = 42;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function between(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
function daysAgo(max: number): Date {
  return new Date(Date.now() - rand() * max * 86_400_000);
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const CATEGORIES = [
  ["T-Shirts", "Everyday tees and graphic prints"],
  ["Shirts", "Casual and formal shirts"],
  ["Kurtas", "Cotton and linen kurtas"],
  ["Jeans", "Denim in every fit"],
  ["Trousers", "Chinos, joggers and formals"],
  ["Jackets", "Denim, bomber and puffer"],
  ["Ethnic Wear", "Sherwanis, nehru jackets and dhotis"],
  ["Footwear", "Sneakers, loafers and sandals"],
  ["Accessories", "Belts, caps and bags"],
  ["Activewear", "Tracksuits and training gear"],
];

const COLORS = ["Navy", "Olive", "Charcoal", "White", "Maroon", "Mustard", "Indigo", "Teal", "Beige", "Black", "Rust", "Sage"];
const MATERIALS = ["Cotton", "Linen", "Denim", "Khadi", "Fleece", "Silk-blend", "Chambray", "Corduroy", "Oxford", "Poplin"];
const ITEMS_BY_CATEGORY: Record<string, string[]> = {
  "T-Shirts": ["Crew Tee", "Polo", "Henley", "Oversized Tee", "Graphic Tee"],
  Shirts: ["Oxford Shirt", "Flannel Shirt", "Cuban Collar Shirt", "Mandarin Collar Shirt", "Slim Formal Shirt"],
  Kurtas: ["Straight Kurta", "Short Kurta", "Pathani Kurta", "Chikankari Kurta", "Bandhgala Kurta"],
  Jeans: ["Slim Jeans", "Straight Jeans", "Tapered Jeans", "Relaxed Jeans", "Cargo Jeans"],
  Trousers: ["Chinos", "Joggers", "Pleated Trousers", "Cargo Pants", "Formal Trousers"],
  Jackets: ["Denim Jacket", "Bomber Jacket", "Puffer Jacket", "Overshirt", "Harrington Jacket"],
  "Ethnic Wear": ["Nehru Jacket", "Sherwani", "Dhoti Set", "Kurta Pyjama Set", "Pathani Suit"],
  Footwear: ["Sneakers", "Loafers", "Kolhapuri Sandals", "Chelsea Boots", "Slides"],
  Accessories: ["Leather Belt", "Baseball Cap", "Canvas Tote", "Wool Scarf", "Card Wallet"],
  Activewear: ["Tracksuit", "Training Tee", "Running Shorts", "Zip Hoodie", "Compression Tights"],
};

const FIRST_NAMES = [
  "Asha", "Ravi", "Priya", "Arjun", "Meera", "Karthik", "Divya", "Rahul", "Sneha", "Vikram", "Ananya", "Suresh",
  "Nisha", "Aditya", "Pooja", "Farhan", "Lakshmi", "Imran", "Kavya", "Rohan", "Zara", "Manoj", "Ritu", "Sameer",
];
const LAST_NAMES = [
  "Menon", "Kumar", "Nair", "Sharma", "Iyer", "Reddy", "Patel", "Singh", "Pillai", "Khan", "Das", "Joshi",
  "Bose", "Rao", "Verma", "Chopra", "Mishra", "Sheikh", "Thomas", "Gupta",
];

async function main() {
  const databaseUrl = process.env.DATABASE_PRIMARY_URL;
  if (!databaseUrl) throw new Error("DATABASE_PRIMARY_URL is required.");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production.");

  const client = new Client({ connectionString: databaseUrl, ssl: pgSslConfig() });
  await client.connect();

  try {
    await client.query("BEGIN");

    // Tenant + owner (not RLS-protected — the registry tables).
    const passwordHash = await bcrypt.hash(ownerPassword, 10);
    const {
      rows: [tenant],
    } = await client.query<{ id: string; existed: boolean }>(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id, (xmax <> 0) AS existed`,
      [tenantName, slug],
    );
    const tenantId = tenant.id;
    const {
      rows: [user],
    } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
       RETURNING id`,
      [ownerEmail, passwordHash, "Demo Owner"],
    );

    // Everything below is tenant-owned: set the same GUC withTenantContext
    // sets, transaction-scoped, so RLS lets the inserts through.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [tenantId, user.id],
    );

    if (tenant.existed) {
      // Dependency order — nothing cascades in this schema, deliberately.
      for (const table of ["order_items", "orders", "cart_items", "carts", "inventory", "products", "categories", "otp_codes", "customers"]) {
        await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
    }

    // Categories.
    const categoryIds: { id: string; name: string }[] = [];
    for (const [name, description] of CATEGORIES) {
      const {
        rows: [row],
      } = await client.query<{ id: string }>(
        `INSERT INTO categories (tenant_id, name, slug, description, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, name, slugify(name), description, daysAgo(120)],
      );
      categoryIds.push({ id: row.id, name });
    }

    // Products + inventory. Slugs get a numeric suffix so 180 combinations
    // of a small vocabulary never collide on the (tenant, slug) unique index.
    const products: { id: string; name: string; priceCents: number }[] = [];
    const usedNames = new Set<string>();
    for (let i = 0; i < PRODUCTS; i++) {
      const category = pick(categoryIds);
      let name: string;
      do {
        name = `${pick(COLORS)} ${pick(MATERIALS)} ${pick(ITEMS_BY_CATEGORY[category.name])}`;
      } while (usedNames.has(name));
      usedNames.add(name);

      const priceCents = between(299, 8999) * 100; // whole-rupee prices, ₹299–₹8,999
      const roll = rand();
      const status = roll < 0.72 ? "active" : roll < 0.9 ? "draft" : "archived";
      const {
        rows: [row],
      } = await client.query<{ id: string }>(
        `INSERT INTO products (tenant_id, category_id, name, slug, description, price_cents, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          tenantId,
          category.id,
          name,
          `${slugify(name)}-${i + 1}`,
          `${name}. Regular fit, machine washable. Made in India.`,
          priceCents,
          status,
          daysAgo(180),
        ],
      );
      products.push({ id: row.id, name, priceCents });

      // ~10% of products out of stock, a few low, most healthy.
      const stockRoll = rand();
      const quantity = stockRoll < 0.1 ? 0 : stockRoll < 0.25 ? between(1, 5) : between(6, 240);
      await client.query(
        `INSERT INTO inventory (tenant_id, product_id, quantity, updated_at) VALUES ($1, $2, $3, $4)`,
        [tenantId, row.id, quantity, daysAgo(30)],
      );
    }

    // Customers — unique phones per tenant.
    const customers: string[] = [];
    for (let i = 0; i < CUSTOMERS; i++) {
      const name = rand() < 0.15 ? null : `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const phone = `+9198${String(10000000 + i * 7919).slice(-8)}`;
      const {
        rows: [row],
      } = await client.query<{ id: string }>(
        `INSERT INTO customers (tenant_id, phone, name, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, phone, name, daysAgo(150)],
      );
      customers.push(row.id);
    }

    // Orders — 1–4 lines each, name/price snapshotted the way checkout does.
    for (let i = 0; i < ORDERS; i++) {
      const lineCount = between(1, 4);
      const lines = Array.from({ length: lineCount }, () => ({ product: pick(products), quantity: between(1, 3) }));
      const subtotal = lines.reduce((s, l) => s + l.product.priceCents * l.quantity, 0);
      const status = rand() < 0.12 ? "cancelled" : "pending";
      const createdAt = daysAgo(90);
      const {
        rows: [order],
      } = await client.query<{ id: string }>(
        `INSERT INTO orders (tenant_id, customer_id, status, subtotal_cents, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [tenantId, pick(customers), status, subtotal, createdAt],
      );
      for (const line of lines) {
        await client.query(
          `INSERT INTO order_items (tenant_id, order_id, product_id, product_name, price_cents, quantity, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tenantId, order.id, line.product.id, line.product.name, line.product.priceCents, line.quantity, createdAt],
        );
      }
    }

    await client.query("COMMIT");
    console.log(
      `Seeded "${tenantName}" (slug: ${slug}) — ${CATEGORIES.length} categories, ${PRODUCTS} products (+inventory), ${CUSTOMERS} customers, ${ORDERS} orders.`,
    );
    console.log(`merchant-admin login: store slug "${slug}", email ${ownerEmail}, password ${ownerPassword}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
