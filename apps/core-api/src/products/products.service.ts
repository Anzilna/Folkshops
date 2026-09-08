import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";

@Injectable()
export class ProductsService {
  constructor(private readonly dbRouter: DbRouter) {}

  async create(tenantId: string, input: CreateProductDto) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({ tenantId, ...input })
          .returning();
        return product;
      }),
    );
  }

  /**
   * "eventual" — the master spec's own canonical example of a safe-to-be-
   * stale read (non-critical catalog browsing). Nothing here is inventory,
   * payment, or auth-adjacent.
   */
  async list(tenantId: string) {
    return this.dbRouter.read("eventual", (db) =>
      withTenantContext(db, tenantId, async (tx) => tx.select().from(products)),
    );
  }

  /**
   * "strong", deliberately — this same endpoint could be hit right after a
   * merchant edits their own product (wants the fresh write) or by a public
   * storefront visitor (doesn't care either way). Nothing here can tell
   * those apart without separate admin/storefront routing, which doesn't
   * exist yet, so per "if unclear, default to primary" this stays strong.
   */
  async findById(tenantId: string, id: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
        return product ?? null;
      }),
    );
  }

  async update(tenantId: string, id: string, input: UpdateProductDto) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx
          .update(products)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(products.id, id))
          .returning();
        return product ?? null;
      }),
    );
  }

  async delete(tenantId: string, id: string) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx.delete(products).where(eq(products.id, id)).returning();
        return product ?? null;
      }),
    );
  }
}
