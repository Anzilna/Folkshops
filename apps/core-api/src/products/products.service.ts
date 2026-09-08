import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { CacheService } from "../redis/cache.service";
import { products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";

const LIST_CACHE_TTL_SECONDS = 30;

function listCacheKey(tenantId: string): string {
  return `products:list:${tenantId}`;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly dbRouter: DbRouter,
    private readonly cache: CacheService,
  ) {}

  async create(tenantId: string, input: CreateProductDto) {
    const product = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({ tenantId, ...input })
          .returning();
        return product;
      }),
    );
    await this.cache.invalidate(listCacheKey(tenantId));
    return product;
  }

  /**
   * "eventual" — the master spec's own canonical example of a safe-to-be-
   * stale read (non-critical catalog browsing). Nothing here is inventory,
   * payment, or auth-adjacent. Cached on top of that same reasoning: a
   * short TTL (correctness backstop if invalidate() below ever fails to
   * fire — see CacheService) plus active invalidation on every write below,
   * so the common case is fresh immediately, not just "eventually within
   * 30s". Deliberately not applied to findById — see that method for why.
   */
  async list(tenantId: string) {
    return this.cache.getOrSet(listCacheKey(tenantId), LIST_CACHE_TTL_SECONDS, () =>
      this.dbRouter.read("eventual", (db) =>
        withTenantContext(db, tenantId, async (tx) => tx.select().from(products)),
      ),
    );
  }

  /**
   * "strong", deliberately — this same endpoint could be hit right after a
   * merchant edits their own product (wants the fresh write) or by a public
   * storefront visitor (doesn't care either way). Nothing here can tell
   * those apart without separate admin/storefront routing, which doesn't
   * exist yet, so per "if unclear, default to primary" this stays strong.
   * Deliberately NOT cached, for the same reason: caching would reintroduce
   * exactly the staleness this comment says to avoid.
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
    const product = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx
          .update(products)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(products.id, id))
          .returning();
        return product ?? null;
      }),
    );
    await this.cache.invalidate(listCacheKey(tenantId));
    return product;
  }

  async delete(tenantId: string, id: string) {
    const product = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx.delete(products).where(eq(products.id, id)).returning();
        return product ?? null;
      }),
    );
    await this.cache.invalidate(listCacheKey(tenantId));
    return product;
  }
}
