import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { categories } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CacheService } from "../redis/cache.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

const LIST_CACHE_TTL_SECONDS = 30;

function listCacheKey(tenantId: string): string {
  return `categories:list:${tenantId}`;
}

/** Same shape as ProductsService throughout — see that file's comments for
 * the reasoning behind the read-consistency and caching choices below. */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly dbRouter: DbRouter,
    private readonly cache: CacheService,
  ) {}

  async create(tenantId: string, input: CreateCategoryDto) {
    const category = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [category] = await tx
          .insert(categories)
          .values({ tenantId, ...input })
          .returning();
        return category;
      }),
    );
    await this.cache.invalidate(listCacheKey(tenantId));
    return category;
  }

  /** "eventual" + cached — catalog browsing, same reasoning as products.list(). */
  async list(tenantId: string) {
    return this.cache.getOrSet(listCacheKey(tenantId), LIST_CACHE_TTL_SECONDS, () =>
      this.dbRouter.read("eventual", (db) =>
        withTenantContext(db, tenantId, async (tx) => tx.select().from(categories)),
      ),
    );
  }

  /** "strong", uncached — same reasoning as products.findById(). */
  async findById(tenantId: string, id: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [category] = await tx.select().from(categories).where(eq(categories.id, id)).limit(1);
        return category ?? null;
      }),
    );
  }

  async update(tenantId: string, id: string, input: UpdateCategoryDto) {
    const category = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [category] = await tx
          .update(categories)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(categories.id, id))
          .returning();
        return category ?? null;
      }),
    );
    await this.cache.invalidate(listCacheKey(tenantId));
    return category;
  }

  async delete(tenantId: string, id: string) {
    const category = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [category] = await tx.delete(categories).where(eq(categories.id, id)).returning();
        return category ?? null;
      }),
    );
    await this.cache.invalidate(listCacheKey(tenantId));
    return category;
  }
}
