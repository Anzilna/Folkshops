import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import Redis from "ioredis";
import request from "supertest";
import { bootstrapTestApp, cleanupTestTenant, createTestTenant, type TestTenant } from "../test-utils/bootstrap-app";
import { buildProductListCacheKey, productsAllListsTag, productTag } from "./products-cache";

/**
 * Real Postgres, real Redis, real HTTP layer — verifies the tag-based
 * product-list cache actually behaves the way CacheService's own unit-
 * level tests (cache.service.integration.spec.ts) prove the primitives
 * do, wired through the real ProductsController/ProductsService this
 * time: one cached response per list query, multiple products' tags all
 * pointing at that same response (not a copy each), a targeted update
 * invalidating exactly the pages that contained it, and tenant isolation
 * holding under the real key/tag naming from products-cache.ts.
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let app: INestApplication;
let redis: Redis;
let tenantA: TestTenant & { ownerEmail: string; ownerPassword: string };
let tenantB: TestTenant & { ownerEmail: string; ownerPassword: string };

async function staffLogin(tenant: TestTenant & { ownerEmail: string; ownerPassword: string }): Promise<string> {
  const res = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);
  const raw = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("fk_access_token="))!;
  return raw.split(";")[0]!.split("=")[1]!;
}

async function createProduct(
  tenant: TestTenant & { ownerEmail: string; ownerPassword: string },
  name: string,
  status: "draft" | "active" = "active",
) {
  const access = await staffLogin(tenant);
  const res = await request(app.getHttpServer())
    .post("/products")
    .set("Cookie", `fk_access_token=${access}`)
    .set("X-Tenant-Id", tenant.slug)
    .send({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), priceCents: 50000, status })
    .expect(201);
  return res.body.id as string;
}

async function listProducts(tenant: TestTenant & { ownerEmail: string; ownerPassword: string }, query = "") {
  const access = await staffLogin(tenant);
  return request(app.getHttpServer())
    .get(`/products${query}`)
    .set("Cookie", `fk_access_token=${access}`)
    .set("X-Tenant-Id", tenant.slug)
    .expect(200);
}

beforeAll(async () => {
  redis = new Redis(REDIS_URL);
  app = await bootstrapTestApp((builder) => builder.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true }));
  tenantA = await createTestTenant(app);
  tenantB = await createTestTenant(app);
});

afterAll(async () => {
  await cleanupTestTenant(tenantA.id);
  await cleanupTestTenant(tenantB.id);
  await redis.quit();
  await app.close();
});

test("a product list request creates exactly one cached response, tagged per-tenant and per-product", async () => {
  const idA = await createProduct(tenantA, `Cache Test A ${Date.now()}`);
  const idB = await createProduct(tenantA, `Cache Test B ${Date.now()}`);

  const res = await listProducts(tenantA);
  const listedIds: string[] = res.body.data.map((p: { id: string }) => p.id);
  expect(listedIds).toEqual(expect.arrayContaining([idA, idB]));

  const cacheKey = buildProductListCacheKey(tenantA.id, { page: 1, limit: 20 });
  expect(await redis.exists(cacheKey)).toBe(1);

  // Every product on the page has its own tag, and every one of those
  // tags points at the *same* single cached key — not a copy per tag.
  for (const id of [idA, idB]) {
    expect(await redis.smembers(productTag(tenantA.id, id))).toEqual([cacheKey]);
  }
  expect(await redis.smembers(productsAllListsTag(tenantA.id))).toEqual([cacheKey]);
});

test("updating a product invalidates the cached page(s) that contained it — a subsequent read reflects the change", async () => {
  const id = await createProduct(tenantA, `Cache Update Test ${Date.now()}`);
  await listProducts(tenantA); // populate the cache

  const cacheKey = buildProductListCacheKey(tenantA.id, { page: 1, limit: 20 });
  expect(await redis.exists(cacheKey)).toBe(1);

  const access = await staffLogin(tenantA);
  await request(app.getHttpServer())
    .patch(`/products/${id}`)
    .set("Cookie", `fk_access_token=${access}`)
    .set("X-Tenant-Id", tenantA.slug)
    .send({ name: "Renamed by cache-invalidation test" })
    .expect(200);

  // The tag deletes the page it referenced, and itself.
  expect(await redis.exists(cacheKey)).toBe(0);
  expect(await redis.exists(productTag(tenantA.id, id))).toBe(0);

  const res = await listProducts(tenantA);
  const renamed = res.body.data.find((p: { id: string }) => p.id === id);
  expect(renamed.name).toBe("Renamed by cache-invalidation test");
});

test("updating a product's status also invalidates a filtered page the product didn't previously qualify for", async () => {
  const id = await createProduct(tenantA, `Cache Filter Shift Test ${Date.now()}`, "draft");

  // Caches a "?status=active" page while the product is still draft, so it
  // isn't on this page and has no productTag reference to it.
  const activeQuery = buildProductListCacheKey(tenantA.id, { page: 1, limit: 20, status: "active" });
  await listProducts(tenantA, "?status=active");
  expect(await redis.exists(activeQuery)).toBe(1);

  const access = await staffLogin(tenantA);
  await request(app.getHttpServer())
    .patch(`/products/${id}`)
    .set("Cookie", `fk_access_token=${access}`)
    .set("X-Tenant-Id", tenantA.slug)
    .send({ status: "active" })
    .expect(200);

  // A fine-grained-only invalidation (the old behavior) would leave this
  // page cached and stale, since the product was never tagged onto it.
  // The tenant-wide tag closes that gap.
  expect(await redis.exists(activeQuery)).toBe(0);

  const afterRes = await listProducts(tenantA, "?status=active");
  expect(afterRes.body.data.some((p: { id: string }) => p.id === id)).toBe(true);
});

test("invalidating tenant A's product cache never touches tenant B's cached list", async () => {
  await createProduct(tenantA, `Isolation A ${Date.now()}`);
  const idB = await createProduct(tenantB, `Isolation B ${Date.now()}`);
  await listProducts(tenantA);
  await listProducts(tenantB);

  const keyB = buildProductListCacheKey(tenantB.id, { page: 1, limit: 20 });
  expect(await redis.exists(keyB)).toBe(1);

  const accessA = await staffLogin(tenantA);
  const productA = (await listProducts(tenantA)).body.data[0];
  await request(app.getHttpServer())
    .patch(`/products/${productA.id}`)
    .set("Cookie", `fk_access_token=${accessA}`)
    .set("X-Tenant-Id", tenantA.slug)
    .send({ name: "Tenant A only change" })
    .expect(200);

  // Tenant B's cached page is completely unaffected by tenant A's write.
  expect(await redis.exists(keyB)).toBe(1);
  const stillCachedB = JSON.parse((await redis.get(keyB))!);
  expect(stillCachedB.data.some((p: { id: string }) => p.id === idB)).toBe(true);
});

test("creating a new product invalidates the tenant-wide list tag, so it shows up in an already-cached view immediately", async () => {
  await createProduct(tenantB, `Pre-existing ${Date.now()}`);
  await listProducts(tenantB); // cache "page 1" without the product created below
  const cacheKey = buildProductListCacheKey(tenantB.id, { page: 1, limit: 20 });
  expect(await redis.exists(cacheKey)).toBe(1);

  const newId = await createProduct(tenantB, `Just Created ${Date.now()}`);

  // create() invalidates the tenant-wide tag, which evicts the page above.
  expect(await redis.exists(cacheKey)).toBe(0);

  const res = await listProducts(tenantB);
  expect(res.body.data.some((p: { id: string }) => p.id === newId)).toBe(true);
});
