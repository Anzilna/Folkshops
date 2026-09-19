import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { cartItems, carts, products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";

/**
 * Customer-scoped (one cart per customer, see carts.ts) — every method
 * takes tenantId + customerId and never trusts a cart/cartItem id handed
 * back by a client without re-deriving "this customer's own cart" first,
 * same layered-isolation instinct as the rest of the app: RLS stops one
 * tenant reaching another's cart, this stops one customer reaching another
 * customer's cart within the same tenant (RLS has no concept of customer,
 * only tenant).
 *
 * "strong" reads throughout, never cached — a customer adding an item and
 * immediately re-fetching their cart must see it, and cart contents are
 * exactly the kind of per-customer, checkout-adjacent state the codebase's
 * existing caching rules already say to leave alone (see CacheService).
 */
@Injectable()
export class CartService {
  constructor(private readonly dbRouter: DbRouter) {}

  private async getOrCreateCartId(tenantId: string, customerId: string): Promise<string> {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [existing] = await tx.select({ id: carts.id }).from(carts).where(eq(carts.customerId, customerId)).limit(1);
        if (existing) return existing.id;

        const [created] = await tx.insert(carts).values({ tenantId, customerId }).returning({ id: carts.id });
        return created.id;
      }),
    );
  }

  /** The cart with its items joined against current product name/price —
   * unlike order_items, cart contents show live prices, not a snapshot;
   * nothing has been paid for yet. */
  async getCart(tenantId: string, customerId: string) {
    const cartId = await this.getOrCreateCartId(tenantId, customerId);

    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const rows = await tx
          .select({
            productId: cartItems.productId,
            quantity: cartItems.quantity,
            name: products.name,
            priceCents: products.priceCents,
            imageUrl: products.imageUrl,
          })
          .from(cartItems)
          .innerJoin(products, eq(cartItems.productId, products.id))
          .where(eq(cartItems.cartId, cartId));

        const items = rows.map((row) => ({ ...row, lineTotalCents: row.priceCents * row.quantity }));
        const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);

        return { id: cartId, items, subtotalCents };
      }),
    );
  }

  async addItem(tenantId: string, customerId: string, productId: string, quantity: number) {
    const cartId = await this.getOrCreateCartId(tenantId, customerId);

    await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
        if (!product) throw new NotFoundException("Product not found");

        const [existing] = await tx
          .select()
          .from(cartItems)
          .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)))
          .limit(1);

        if (existing) {
          await tx
            .update(cartItems)
            .set({ quantity: existing.quantity + quantity, updatedAt: new Date() })
            .where(eq(cartItems.id, existing.id));
        } else {
          await tx.insert(cartItems).values({ tenantId, cartId, productId, quantity });
        }
      }),
    );

    return this.getCart(tenantId, customerId);
  }

  async updateItemQuantity(tenantId: string, customerId: string, productId: string, quantity: number) {
    const cartId = await this.getOrCreateCartId(tenantId, customerId);

    const updated = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .update(cartItems)
          .set({ quantity, updatedAt: new Date() })
          .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)))
          .returning();
        return row ?? null;
      }),
    );
    if (!updated) throw new NotFoundException("Item not in cart");

    return this.getCart(tenantId, customerId);
  }

  async removeItem(tenantId: string, customerId: string, productId: string) {
    const cartId = await this.getOrCreateCartId(tenantId, customerId);

    await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) =>
        tx.delete(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId))),
      ),
    );

    return this.getCart(tenantId, customerId);
  }
}
