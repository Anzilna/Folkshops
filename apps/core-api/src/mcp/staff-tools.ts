import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CustomersService } from "../customers/customers.service";
import type { InventoryService } from "../inventory/inventory.service";
import type { QueryOrdersDto } from "../orders/dto/query-orders.dto";
import { GetOrderQuery } from "../orders/queries/get-order.query";
import { ListOrdersQuery } from "../orders/queries/list-orders.query";
import { UpdateProductCommand } from "../products/commands/update-product.command";
import type { QueryProductsDto } from "../products/dto/query-products.dto";
import type { UpdateProductDto } from "../products/dto/update-product.dto";
import { GetProductQuery } from "../products/queries/get-product.query";
import { ListProductsQuery } from "../products/queries/list-products.query";
import { runTool } from "./mcp-http";
import { customerSummary, inventoryRow, orderDetail, orderSummary, OrderRow, productDetail, productSummary } from "./projections";

export interface StaffToolDeps {
  commandBus: CommandBus;
  queryBus: QueryBus;
  inventory: InventoryService;
  customers: CustomersService;
}

const ORDER_STATUSES = ["pending", "awaiting_payment", "paid", "payment_failed", "cancelled", "refunded", "partially_refunded"] as const;
const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;

/**
 * The Store Copilot's tools. tenantId comes from the verified staff token
 * (StaffMcpGuard), captured in this closure — no tool takes a tenant, store
 * or user id as an argument, so the model has no way to even express
 * "another store". Every read/write goes through the same Commands/Queries/
 * services the REST controllers use, so caching, soft-delete filtering and
 * RLS all apply exactly as they do for a merchant clicking in the admin.
 *
 * Schemas are .strict(): an unexpected argument (a smuggled tenant_id, a
 * typo) is a validation error, not silently ignored. Names and argument
 * shapes must match ai-service's own catalog (app/domain/tools/catalog.py)
 * — ai-service hides any tool whose argument names drift from what it
 * expects, so a mismatch fails closed rather than calling with bad args.
 */
export function registerStaffTools(server: McpServer, tenantId: string, deps: StaffToolDeps): void {
  server.registerTool(
    "search_products",
    {
      description: "Search the store's products by name/description. Includes drafts and archived products.",
      inputSchema: z
        .object({
          query: z.string().max(200).optional(),
          status: z.enum(PRODUCT_STATUSES).optional(),
          limit: z.number().int().min(1).max(20).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      runTool("search_products", async () => {
        const dto: QueryProductsDto = { page: 1, limit: args.limit ?? 10, search: args.query, status: args.status };
        const result = await deps.queryBus.execute(new ListProductsQuery(tenantId, dto));
        return { total: result.total, products: result.data.map(productSummary) };
      }),
  );

  server.registerTool(
    "get_product",
    {
      description: "Get one product's details by id.",
      inputSchema: z.object({ product_id: z.uuid() }).strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      runTool("get_product", async () => {
        const product = await deps.queryBus.execute(new GetProductQuery(tenantId, args.product_id));
        if (!product) throw new NotFoundException("Product not found");
        return { product: productDetail(product) };
      }),
  );

  server.registerTool(
    "list_inventory",
    {
      description: "List stock levels. sort=lowest_first finds products running out of stock.",
      inputSchema: z
        .object({
          query: z.string().max(200).optional(),
          sort: z.enum(["lowest_first", "recently_updated"]).optional(),
          limit: z.number().int().min(1).max(20).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      runTool("list_inventory", async () => {
        const lowest = (args.sort ?? "lowest_first") === "lowest_first";
        const result = await deps.inventory.list(tenantId, {
          page: 1,
          limit: args.limit ?? 10,
          search: args.query,
          sortBy: lowest ? "quantity" : "updatedAt",
          sortDir: lowest ? "asc" : "desc",
        });
        return { total: result.total, items: result.data.map(inventoryRow) };
      }),
  );

  server.registerTool(
    "search_orders",
    {
      description: "List the store's orders, newest first. query matches the customer's phone number.",
      inputSchema: z
        .object({
          status: z.enum(ORDER_STATUSES).optional(),
          query: z.string().max(50).optional(),
          limit: z.number().int().min(1).max(20).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      runTool("search_orders", async () => {
        const dto: QueryOrdersDto = {
          page: 1,
          limit: args.limit ?? 10,
          status: args.status,
          search: args.query,
          sortBy: "createdAt",
          sortDir: "desc",
        };
        const result = await deps.queryBus.execute(new ListOrdersQuery(tenantId, dto));
        return { total: result.total, orders: result.data.map((o: OrderRow) => orderSummary(o, { includeCustomer: true })) };
      }),
  );

  server.registerTool(
    "get_order",
    {
      description: "Get one order with its line items.",
      inputSchema: z.object({ order_id: z.uuid() }).strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      runTool("get_order", async () => {
        const order = await deps.queryBus.execute(new GetOrderQuery(tenantId, args.order_id));
        if (!order) throw new NotFoundException("Order not found");
        return { order: orderDetail(order, { includeCustomer: true }) };
      }),
  );

  server.registerTool(
    "get_customer",
    {
      description: "Get a customer's name and masked phone number by id.",
      inputSchema: z.object({ customer_id: z.uuid() }).strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      runTool("get_customer", async () => {
        const customer = await deps.customers.findById(tenantId, args.customer_id);
        if (!customer) throw new NotFoundException("Customer not found");
        return { customer: customerSummary(customer) };
      }),
  );

  // --- Mutations. ai-service only ever calls these after the merchant
  // clicked Confirm on a server-rendered summary (see its
  // application/agent/confirmation.py). Both set absolute values, so a
  // retried call after a lost response can't double-apply anything.

  server.registerTool(
    "update_product",
    {
      description: "Change a product's name, price, publish status or active flag. Only the given fields change.",
      inputSchema: z
        .object({
          product_id: z.uuid(),
          name: z.string().min(1).max(200).optional(),
          price_cents: z.number().int().min(0).max(100_000_000).optional(),
          status: z.enum(PRODUCT_STATUSES).optional(),
          is_active: z.boolean().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) =>
      runTool("update_product", async () => {
        const dto: UpdateProductDto = {};
        if (args.name !== undefined) dto.name = args.name;
        if (args.price_cents !== undefined) dto.priceCents = args.price_cents;
        if (args.status !== undefined) dto.status = args.status;
        if (args.is_active !== undefined) dto.isActive = args.is_active;
        if (Object.keys(dto).length === 0) throw new BadRequestException("Nothing to update");
        const product = await deps.commandBus.execute(new UpdateProductCommand(tenantId, args.product_id, dto));
        if (!product) throw new NotFoundException("Product not found");
        return { product: productDetail(product) };
      }),
  );

  server.registerTool(
    "set_inventory_quantity",
    {
      description: "Set (not add to) the stock quantity for a product. Creates the stock record if the product has none.",
      inputSchema: z.object({ product_id: z.uuid(), quantity: z.number().int().min(0).max(1_000_000) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) =>
      runTool("set_inventory_quantity", async () => {
        const updated =
          (await deps.inventory.update(tenantId, args.product_id, { quantity: args.quantity })) ??
          (await deps.inventory.create(tenantId, { productId: args.product_id, quantity: args.quantity, isActive: true }));
        if (!updated) throw new NotFoundException("Product not found");
        return { item: inventoryRow(updated) };
      }),
  );
}
