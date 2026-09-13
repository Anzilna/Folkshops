import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { inventory, products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";

/**
 * Staff-only, no public read — unlike products/categories there's no
 * storefront caller for exact stock counts yet, so there's no public
 * endpoint to build. "strong" reads throughout, deliberately not cached:
 * a merchant checking stock right after adjusting it should see the
 * adjustment immediately, and staleness here is a much worse failure mode
 * than on catalog browsing (over-promising stock that's already gone).
 *
 * setQuantity() is a plain overwrite, not an atomic increment/decrement —
 * see inventory.ts schema comment on why this isn't a reservation system.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly dbRouter: DbRouter) {}

  async list(tenantId: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => tx.select().from(inventory)),
    );
  }

  async findByProductId(tenantId: string, productId: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx.select().from(inventory).where(eq(inventory.productId, productId)).limit(1);
        return row ?? null;
      }),
    );
  }

  /**
   * Upserts the inventory row for a product — most products won't have one
   * yet (inventory isn't created alongside a product, only once someone
   * sets a quantity for it). Returns null if the product itself doesn't
   * exist for this tenant, so a caller can't create inventory pointing at
   * another tenant's product id (RLS scopes the inventory row's own
   * tenant_id, but doesn't stop that cross-tenant reference by itself —
   * this existence check is what does).
   */
  async setQuantity(tenantId: string, productId: string, quantity: number) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
        if (!product) return null;

        const [existing] = await tx.select().from(inventory).where(eq(inventory.productId, productId)).limit(1);
        if (existing) {
          const [row] = await tx
            .update(inventory)
            .set({ quantity, updatedAt: new Date() })
            .where(eq(inventory.productId, productId))
            .returning();
          return row;
        }

        const [row] = await tx
          .insert(inventory)
          .values({ tenantId, productId, quantity })
          .returning();
        return row;
      }),
    );
  }
}
