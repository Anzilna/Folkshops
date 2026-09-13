import { BadRequestException, Injectable } from "@nestjs/common";
import { and, count, eq, ilike, SQL } from "drizzle-orm";
import { CsvColumn, toCsv } from "../common/csv.util";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../common/pagination.util";
import { DbRouter } from "../database/db-router";
import { cartItems, carts, customers, orderItems, orders, products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { QueryOrdersDto } from "./dto/query-orders.dto";

const SORT_COLUMNS = {
  createdAt: orders.createdAt,
  subtotalCents: orders.subtotalCents,
  status: orders.status,
} as const;

function buildFilters(tenantId: string, query: QueryOrdersDto): SQL | undefined {
  const clauses = [eq(orders.tenantId, tenantId)];
  if (query.status) clauses.push(eq(orders.status, query.status));
  if (query.search) clauses.push(ilike(customers.phone, `%${query.search}%`));
  return and(...clauses);
}

const EXPORT_COLUMNS: CsvColumn<typeof orders.$inferSelect & { customerPhone: string }>[] = [
  { key: "id", header: "id" },
  { key: "customerPhone", header: "customerPhone" },
  { key: "status", header: "status" },
  { key: "subtotalCents", header: "subtotalCents" },
  { key: "createdAt", header: "createdAt", value: (row) => row.createdAt.toISOString() },
];

/**
 * Phase 1 scope only — see orders.ts schema comment. checkout() does the
 * whole cart-snapshot in one write transaction (withTenantContext already
 * wraps every call in db.transaction), so an order is never left half
 * created: order + its order_items + the cart being cleared all commit or
 * roll back together. What it deliberately does NOT do: touch inventory
 * (no decrement, no reservation/locking — Phase 2), take a payment, or
 * assign any status beyond the "pending" default.
 *
 * No importRows() here, unlike products/categories/inventory/customers —
 * bulk-importing orders doesn't correspond to anything a real merchant
 * does; orders only ever come from a customer's own checkout. Export
 * stays (reporting/reconciliation is a legitimate use), import doesn't.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly dbRouter: DbRouter) {}

  async checkout(tenantId: string, customerId: string) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [cart] = await tx.select({ id: carts.id }).from(carts).where(eq(carts.customerId, customerId)).limit(1);
        if (!cart) throw new BadRequestException("Cart is empty");

        const lines = await tx
          .select({
            productId: cartItems.productId,
            quantity: cartItems.quantity,
            name: products.name,
            priceCents: products.priceCents,
          })
          .from(cartItems)
          .innerJoin(products, eq(cartItems.productId, products.id))
          .where(eq(cartItems.cartId, cart.id));

        if (lines.length === 0) throw new BadRequestException("Cart is empty");

        const subtotalCents = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);

        const [order] = await tx.insert(orders).values({ tenantId, customerId, subtotalCents }).returning();

        const items = await tx
          .insert(orderItems)
          .values(
            lines.map((line) => ({
              tenantId,
              orderId: order.id,
              productId: line.productId,
              productName: line.name,
              priceCents: line.priceCents,
              quantity: line.quantity,
            })),
          )
          .returning();

        await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));

        return { ...order, items };
      }),
    );
  }

  /** "strong", uncached — order history is exactly the kind of read that
   * must reflect the checkout that (maybe) just happened, same reasoning
   * as CartService. */
  async listForCustomer(tenantId: string, customerId: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => tx.select().from(orders).where(eq(orders.customerId, customerId))),
    );
  }

  /** Staff-side listing — paginated/sorted/filtered, joined against
   * customers so `search` can match the customer's phone number. */
  async listForTenant(tenantId: string, query: QueryOrdersDto): Promise<PaginatedResult<typeof orders.$inferSelect>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    const orderColumns = {
      id: orders.id,
      tenantId: orders.tenantId,
      customerId: orders.customerId,
      status: orders.status,
      subtotalCents: orders.subtotalCents,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
    };

    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const base = tx.select(orderColumns).from(orders).innerJoin(customers, eq(orders.customerId, customers.id));
        const countBase = tx.select({ total: count() }).from(orders).innerJoin(customers, eq(orders.customerId, customers.id));

        const [rows, [{ total }]] = await Promise.all([
          base.where(where).orderBy(orderBy).limit(limit).offset(offsetFor(page, limit)),
          countBase.where(where),
        ]);
        return paginatedResult(rows, total, page, limit);
      }),
    );
  }

  async exportCsv(tenantId: string, query: QueryOrdersDto): Promise<string> {
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    const rows = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) =>
        tx
          .select({
            id: orders.id,
            tenantId: orders.tenantId,
            customerId: orders.customerId,
            status: orders.status,
            subtotalCents: orders.subtotalCents,
            createdAt: orders.createdAt,
            updatedAt: orders.updatedAt,
            customerPhone: customers.phone,
          })
          .from(orders)
          .innerJoin(customers, eq(orders.customerId, customers.id))
          .where(where)
          .orderBy(orderBy),
      ),
    );
    return toCsv(rows, EXPORT_COLUMNS);
  }

  async findById(tenantId: string, id: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
        if (!order) return null;
        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));
        return { ...order, items };
      }),
    );
  }
}
