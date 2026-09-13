import { BadRequestException, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { cartItems, carts, orderItems, orders, products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";

/**
 * Phase 1 scope only — see orders.ts schema comment. checkout() does the
 * whole cart-snapshot in one write transaction (withTenantContext already
 * wraps every call in db.transaction), so an order is never left half
 * created: order + its order_items + the cart being cleared all commit or
 * roll back together. What it deliberately does NOT do: touch inventory
 * (no decrement, no reservation/locking — Phase 2), take a payment, or
 * assign any status beyond the "pending" default.
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

        // Cart is spent — checkout consumes it, same as a real store's cart
        // going empty right after you place an order.
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

  /** Staff-side listing — every order for the tenant, not scoped to one customer. */
  async listForTenant(tenantId: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => tx.select().from(orders)),
    );
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
