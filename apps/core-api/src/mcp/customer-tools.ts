import { NotFoundException } from "@nestjs/common";
import type { QueryBus } from "@nestjs/cqrs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CartService } from "../cart/cart.service";
import { GetCustomerOrderQuery } from "../orders/queries/get-customer-order.query";
import { ListCustomerOrdersQuery } from "../orders/queries/list-customer-orders.query";
import type { QueryProductsDto } from "../products/dto/query-products.dto";
import { GetProductQuery } from "../products/queries/get-product.query";
import { ListProductsQuery } from "../products/queries/list-products.query";
import { runTool } from "./mcp-http";
import { cartView, orderDetail, orderSummary, OrderRow, shopperProduct, shopperProductSummary } from "./projections";

export interface CustomerToolDeps {
  queryBus: QueryBus;
  cart: CartService;
}

const MY_ORDERS_MAX = 20;

/**
 * The Shopper Assistant's tools. tenantId and customerId both come from the
 * verified customer token (CustomerMcpGuard) — a shopper's agent can only
 * ever see the public catalog and that one customer's own cart and orders.
 * See staff-tools.ts for the shared conventions (strict schemas, names
 * matching ai-service's catalog, no ids of actors/tenants as arguments).
 */
export function registerCustomerTools(server: McpServer, tenantId: string, customerId: string, deps: CustomerToolDeps): void {
  // A shopper sees what the storefront shows: active, enabled products only.
  // GetProductQuery itself returns drafts too (staff need them), so the
  // filter has to live here, not be assumed from the query.
  async function getVisibleProduct(productId: string) {
    const product = await deps.queryBus.execute(new GetProductQuery(tenantId, productId));
    if (!product || product.status !== "active" || !product.isActive) throw new NotFoundException("Product not found");
    return product;
  }

  server.registerTool(
    "search_products",
    {
      description: "Search the store's catalog by name/description.",
      inputSchema: z.object({ query: z.string().max(200).optional(), limit: z.number().int().min(1).max(20).optional() }).strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      runTool("search_products", async () => {
        const dto: QueryProductsDto = { page: 1, limit: args.limit ?? 10, search: args.query, status: "active", isActive: true };
        const result = await deps.queryBus.execute(new ListProductsQuery(tenantId, dto));
        return { total: result.total, products: result.data.map(shopperProductSummary) };
      }),
  );

  server.registerTool(
    "get_product",
    {
      description: "Get one product's details by id.",
      inputSchema: z.object({ product_id: z.uuid() }).strict(),
      annotations: { readOnlyHint: true },
    },
    (args) => runTool("get_product", async () => ({ product: shopperProduct(await getVisibleProduct(args.product_id)) })),
  );

  server.registerTool(
    "get_cart",
    {
      description: "Get the shopper's own cart.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    () => runTool("get_cart", async () => ({ cart: cartView(await deps.cart.getCart(tenantId, customerId)) })),
  );

  server.registerTool(
    "set_cart_item_quantity",
    {
      description: "Set (not add to) the quantity of one product in the shopper's cart. quantity 0 removes it.",
      inputSchema: z.object({ product_id: z.uuid(), quantity: z.number().int().min(0).max(99) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) =>
      runTool("set_cart_item_quantity", async () => {
        if (args.quantity === 0) {
          return { cart: cartView(await deps.cart.removeItem(tenantId, customerId, args.product_id)) };
        }
        await getVisibleProduct(args.product_id);
        // Absolute, not CartService.addItem's +=: a retried call after a
        // lost response must land on the same quantity, not double it.
        // addItem is only reached when the line doesn't exist yet, where
        // adding N to nothing is the same as setting N.
        try {
          return { cart: cartView(await deps.cart.updateItemQuantity(tenantId, customerId, args.product_id, args.quantity)) };
        } catch (err) {
          if (!(err instanceof NotFoundException)) throw err;
          return { cart: cartView(await deps.cart.addItem(tenantId, customerId, args.product_id, args.quantity)) };
        }
      }),
  );

  server.registerTool(
    "list_my_orders",
    {
      description: "List the shopper's own orders, newest first.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(MY_ORDERS_MAX).optional() }).strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      runTool("list_my_orders", async () => {
        const orders: OrderRow[] = await deps.queryBus.execute(new ListCustomerOrdersQuery(tenantId, customerId));
        const newest = [...orders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, args.limit ?? 10);
        return { total: orders.length, orders: newest.map((o) => orderSummary(o, { includeCustomer: false })) };
      }),
  );

  server.registerTool(
    "get_my_order",
    {
      description: "Get one of the shopper's own orders with its items.",
      inputSchema: z.object({ order_id: z.uuid() }).strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      runTool("get_my_order", async () => {
        const order = await deps.queryBus.execute(new GetCustomerOrderQuery(tenantId, args.order_id));
        // Same 404 for "not yours" and "doesn't exist" — matches
        // StorefrontOrdersController.findOne, so order ids can't be probed.
        if (!order || order.customerId !== customerId) throw new NotFoundException("Order not found");
        return { order: orderDetail(order, { includeCustomer: false }) };
      }),
  );
}
