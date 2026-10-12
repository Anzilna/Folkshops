import { INestApplication } from "@nestjs/common";
import jwt from "jsonwebtoken";
import request from "supertest";
import { STAFF_ACCESS_TOKEN_COOKIE } from "../auth/auth-cookies";
import {
  bootstrapTestApp,
  cleanupTestTenant,
  createTestTenant,
  extractCookie,
  type TestTenant,
} from "../test-utils/bootstrap-app";
import { INTERNAL_SERVICE_HEADER } from "./guards/internal-service.guard";

/**
 * The /internal/mcp/* endpoints through the real HTTP stack: both
 * credentials (service token + user bearer token), tenant taken from the
 * token rather than the Host, the two surfaces kept apart, and the tools
 * themselves scoped to the caller's own store/cart. Raw JSON-RPC over
 * supertest — the same bytes ai-service's MCP client sends.
 */

const SERVICE_TOKEN = "test-internal-service-token";
process.env.INTERNAL_SERVICE_TOKEN = SERVICE_TOKEN;

let app: INestApplication;
let storeA: TestTenant & {
  staffToken: string;
  productId: string;
  draftId: string;
  customerId: string;
  customerPhone: string;
  customerToken: string;
};
let storeB: TestTenant & { staffToken: string; productId: string };

async function staffToken(tenant: TestTenant & { ownerEmail: string; ownerPassword: string }): Promise<string> {
  const res = await request(app.getHttpServer())
    .post("/auth/login")
    .set("X-Tenant-Id", tenant.slug)
    .send({ email: tenant.ownerEmail, password: tenant.ownerPassword })
    .expect(201);
  return extractCookie(res.headers["set-cookie"] as unknown as string[], STAFF_ACCESS_TOKEN_COOKIE)!;
}

async function createProduct(tenant: TestTenant, token: string, name: string, status: "active" | "draft") {
  const res = await request(app.getHttpServer())
    .post("/products")
    .set("X-Tenant-Id", tenant.slug)
    .set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${token}`)
    .send({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), priceCents: 4900, status })
    .expect(201);
  return res.body.id as string;
}

let rpcId = 0;
function rpc(surface: "staff" | "customer", bearer: string | null, method: string, params: object = {}, serviceToken = SERVICE_TOKEN) {
  let req = request(app.getHttpServer())
    .post(`/internal/mcp/${surface}`)
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json");
  if (serviceToken) req = req.set(INTERNAL_SERVICE_HEADER, serviceToken);
  if (bearer) req = req.set("Authorization", `Bearer ${bearer}`);
  return req.send({ jsonrpc: "2.0", id: ++rpcId, method, params });
}

async function callTool(surface: "staff" | "customer", bearer: string, name: string, args: object = {}) {
  const res = await rpc(surface, bearer, "tools/call", { name, arguments: args }).expect(200);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool returns a different JSON shape
  return res.body.result as { isError?: boolean; structuredContent?: any; content: { text: string }[] };
}

beforeAll(async () => {
  app = await bootstrapTestApp();
  const a = await createTestTenant(app);
  const b = await createTestTenant(app);
  const aToken = await staffToken(a);
  const bToken = await staffToken(b);

  const customer = await request(app.getHttpServer())
    .post("/customers")
    .set("X-Tenant-Id", a.slug)
    .set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${aToken}`)
    .send({ phone: `+97150${Math.floor(1000000 + Math.random() * 8999999)}`, name: "Shopper" })
    .expect(201);

  storeA = {
    ...a,
    staffToken: aToken,
    productId: await createProduct(a, aToken, `Saffron Tea ${a.slug}`, "active"),
    draftId: await createProduct(a, aToken, `Secret Draft ${a.slug}`, "draft"),
    customerId: customer.body.id,
    customerPhone: customer.body.phone,
    customerToken: jwt.sign({ sub: customer.body.id, tenantId: a.id, phone: customer.body.phone }, process.env.CUSTOMER_JWT_SECRET ?? "dev-only-change-me-three", {
      expiresIn: "5m",
    }),
  };
  storeB = { ...b, staffToken: bToken, productId: await createProduct(b, bToken, `Other Store Tea ${b.slug}`, "active") };
});

afterAll(async () => {
  await cleanupTestTenant(storeA.id);
  await cleanupTestTenant(storeB.id);
  await app.close();
});

describe("credentials", () => {
  test("needs the internal service token", async () => {
    await rpc("staff", storeA.staffToken, "tools/list", {}, "").expect(401);
    await rpc("staff", storeA.staffToken, "tools/list", {}, "wrong-token").expect(401);
  });

  test("needs a user bearer token — a cookie is not accepted here", async () => {
    await rpc("staff", null, "tools/list").expect(401);
    await request(app.getHttpServer())
      .post("/internal/mcp/staff")
      .set(INTERNAL_SERVICE_HEADER, SERVICE_TOKEN)
      .set("Cookie", `${STAFF_ACCESS_TOKEN_COOKIE}=${storeA.staffToken}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      .expect(401);
  });

  test("each surface only accepts its own token type", async () => {
    await rpc("staff", storeA.customerToken, "tools/list").expect(401);
    await rpc("customer", storeA.staffToken, "tools/list").expect(401);
  });
});

describe("staff surface", () => {
  test("serves exactly the copilot's tools", async () => {
    const res = await rpc("staff", storeA.staffToken, "tools/list").expect(200);
    const names = res.body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "get_customer",
      "get_order",
      "get_product",
      "list_inventory",
      "search_orders",
      "search_products",
      "set_inventory_quantity",
      "update_product",
    ]);
  });

  test("tenant comes from the token: another store's product is invisible", async () => {
    const own = await callTool("staff", storeA.staffToken, "get_product", { product_id: storeA.productId });
    expect(own.isError).toBeFalsy();
    expect(own.structuredContent.product.name).toContain("Saffron Tea");

    const foreign = await callTool("staff", storeA.staffToken, "get_product", { product_id: storeB.productId });
    expect(foreign.isError).toBe(true);
    expect(foreign.structuredContent.error_code).toBe("not_found");

    // No query: a text query goes through Elasticsearch, which CDC fills
    // asynchronously — a product created a moment ago may not be indexed.
    const search = await callTool("staff", storeA.staffToken, "search_products", { limit: 20 });
    const ids = search.structuredContent.products.map((p: { id: string }) => p.id);
    expect(ids).toContain(storeA.productId);
    expect(ids).not.toContain(storeB.productId);
  });

  test("a dev X-Tenant-Id header can't redirect the call to another store", async () => {
    const res = await request(app.getHttpServer())
      .post("/internal/mcp/staff")
      .set("Accept", "application/json, text/event-stream")
      .set(INTERNAL_SERVICE_HEADER, SERVICE_TOKEN)
      .set("Authorization", `Bearer ${storeA.staffToken}`)
      .set("X-Tenant-Id", storeB.slug)
      .send({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "get_product", arguments: { product_id: storeB.productId } } })
      .expect(200);
    expect(res.body.result.structuredContent.error_code).toBe("not_found");
  });

  test("unknown arguments are rejected, not ignored", async () => {
    const res = await callTool("staff", storeA.staffToken, "get_product", { product_id: storeA.productId, tenant_id: storeB.id });
    expect(res.isError).toBe(true);
  });

  test("set_inventory_quantity sets an absolute value and is safe to repeat", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await callTool("staff", storeA.staffToken, "set_inventory_quantity", { product_id: storeA.productId, quantity: 7 });
      expect(res.structuredContent.item.quantity).toBe(7);
    }
  });

  test("customer phone numbers are masked", async () => {
    const res = await callTool("staff", storeA.staffToken, "get_customer", { customer_id: storeA.customerId });
    expect(res.structuredContent.customer.phone_masked).toMatch(/^\+971•+\d{4}$/);
    expect(JSON.stringify(res)).not.toContain(storeA.customerPhone);
  });
});

describe("customer surface", () => {
  test("drafts are invisible to shoppers", async () => {
    const res = await callTool("customer", storeA.customerToken, "get_product", { product_id: storeA.draftId });
    expect(res.structuredContent.error_code).toBe("not_found");
  });

  test("cart quantity is set, not added — a retried call can't double it", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await callTool("customer", storeA.customerToken, "set_cart_item_quantity", { product_id: storeA.productId, quantity: 3 });
      expect(res.structuredContent.cart.items).toEqual([expect.objectContaining({ product_id: storeA.productId, quantity: 3 })]);
    }
    const cleared = await callTool("customer", storeA.customerToken, "set_cart_item_quantity", { product_id: storeA.productId, quantity: 0 });
    expect(cleared.structuredContent.cart.items).toEqual([]);
  });

  test("another store's product can't be added to the cart", async () => {
    const res = await callTool("customer", storeA.customerToken, "set_cart_item_quantity", { product_id: storeB.productId, quantity: 1 });
    expect(res.structuredContent.error_code).toBe("not_found");
  });
});
