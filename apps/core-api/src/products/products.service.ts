import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, asc, count, eq, ilike, isNull, SQL } from "drizzle-orm";
import { bulkImport, BulkImportResult } from "../common/bulk-import.util";
import { CsvColumn, toCsv } from "../common/csv.util";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../common/pagination.util";
import { DbRouter } from "../database/db-router";
import type { Db } from "../database/tokens";
import { productImages, products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CacheService } from "../redis/cache.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { QueryProductsDto } from "./dto/query-products.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { buildProductListCacheKey, productsAllListsTag, productTag } from "./products-cache";

const SORT_COLUMNS = {
  name: products.name,
  priceCents: products.priceCents,
  status: products.status,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
} as const;

function buildFilters(tenantId: string, query: QueryProductsDto): SQL | undefined {
  // isNull(deletedAt) always applies — a soft-deleted row must behave as
  // gone for every normal read path, no caller opts back into seeing it.
  const clauses = [eq(products.tenantId, tenantId), isNull(products.deletedAt)];
  if (query.status) clauses.push(eq(products.status, query.status));
  if (query.categoryId) clauses.push(eq(products.categoryId, query.categoryId));
  if (query.isActive !== undefined) clauses.push(eq(products.isActive, query.isActive));
  if (query.search) clauses.push(ilike(products.name, `%${query.search}%`));
  return and(...clauses);
}

const EXPORT_COLUMNS: CsvColumn<typeof products.$inferSelect>[] = [
  { key: "id", header: "id" },
  { key: "name", header: "name" },
  { key: "slug", header: "slug" },
  { key: "description", header: "description" },
  { key: "priceCents", header: "priceCents" },
  { key: "status", header: "status" },
  { key: "isActive", header: "isActive" },
  { key: "categoryId", header: "categoryId" },
  { key: "imageUrl", header: "imageUrl" },
];

/** Whole-array replace: delete every gallery row for this product, then
 * insert the given URLs in order. Runs inside the same transaction as the
 * product write that triggered it (withTenantContext already wraps every
 * call in db.transaction), so a product's core fields and its gallery
 * never end up out of sync even if one insert in the middle fails. */
async function replaceGallery(tx: Db, tenantId: string, productId: string, urls: string[]): Promise<void> {
  await tx.delete(productImages).where(eq(productImages.productId, productId));
  if (urls.length === 0) return;
  await tx.insert(productImages).values(urls.map((url, position) => ({ tenantId, productId, url, position })));
}

@Injectable()
export class ProductsService {
  private readonly listTtlSeconds: number;

  constructor(
    private readonly dbRouter: DbRouter,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    this.listTtlSeconds = Number(config.get<string>("CACHE_PRODUCTS_LIST_TTL_SECONDS") ?? 30);
  }

  async create(tenantId: string, input: CreateProductDto) {
    const { images, ...productInput } = input;
    const created = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({ tenantId, ...productInput })
          .returning();
        if (images) await replaceGallery(tx, tenantId, product.id, images);
        return { ...product, images: images ?? [] };
      }),
    );
    // A new product has no per-product tag yet (see products-cache.ts's
    // own comment on productsAllListsTag) — only the tenant-wide tag can
    // make it show up in an already-cached list view immediately.
    await this.cache.invalidateTag(productsAllListsTag(tenantId));
    return created;
  }

  /**
   * Paginated/sorted/filtered — "eventual" (replica-tolerant, same
   * reasoning as before: this is catalog browsing, non-critical staleness)
   * for the underlying DB read on a cache miss. Cached, cache-aside, tag-
   * based — every cached page is indexed under one tag per product it
   * contains (invalidated precisely by update()/delete()) plus one
   * tenant-wide tag (invalidated by create() — see products-cache.ts for
   * why that split exists). Re-enabled after being pulled from the pre-
   * pagination version of this method, which had no way to invalidate a
   * write against the many distinct page/sort/filter cache-key variants a
   * paginated endpoint produces; the tag mechanism is what closes that gap
   * (see CacheService's own comment for the full mechanism).
   */
  async list(tenantId: string, query: QueryProductsDto): Promise<PaginatedResult<typeof products.$inferSelect>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");
    const cacheKey = buildProductListCacheKey(tenantId, query);

    return this.cache.getOrSetTagged(
      cacheKey,
      this.listTtlSeconds,
      () =>
        this.dbRouter.read("eventual", (db) =>
          withTenantContext(db, tenantId, async (tx) => {
            const [rows, [{ total }]] = await Promise.all([
              tx.select().from(products).where(where).orderBy(orderBy).limit(limit).offset(offsetFor(page, limit)),
              tx.select({ total: count() }).from(products).where(where),
            ]);
            return paginatedResult(rows, total, page, limit);
          }),
        ),
      (result) => [productsAllListsTag(tenantId), ...result.data.map((product) => productTag(tenantId, product.id))],
    );
  }

  /** All matching rows as CSV, ignoring page/limit — an export is "give me
   * everything that matches the filter", not one page of it. */
  async exportCsv(tenantId: string, query: QueryProductsDto): Promise<string> {
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    const rows = await this.dbRouter.read("eventual", (db) =>
      withTenantContext(db, tenantId, async (tx) => tx.select().from(products).where(where).orderBy(orderBy)),
    );
    return toCsv(rows, EXPORT_COLUMNS);
  }

  /** See bulk-import.util.ts — validates each row against CreateProductDto
   * and inserts one at a time so a bad row doesn't block the rest. */
  async importRows(tenantId: string, rows: Record<string, string>[]): Promise<BulkImportResult> {
    return bulkImport(rows, CreateProductDto, (dto) => this.create(tenantId, dto));
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
        const [product] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, id), isNull(products.deletedAt)))
          .limit(1);
        if (!product) return null;
        const gallery = await tx.select().from(productImages).where(eq(productImages.productId, id)).orderBy(asc(productImages.position));
        return { ...product, images: gallery.map((g) => g.url) };
      }),
    );
  }

  async update(tenantId: string, id: string, input: UpdateProductDto) {
    const { images, ...productInput } = input;
    const updated = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx
          .update(products)
          .set({ ...productInput, updatedAt: new Date() })
          .where(and(eq(products.id, id), isNull(products.deletedAt)))
          .returning();
        if (!product) return null;
        if (images) await replaceGallery(tx, tenantId, id, images);
        const gallery = await tx.select().from(productImages).where(eq(productImages.productId, id)).orderBy(asc(productImages.position));
        return { ...product, images: gallery.map((g) => g.url) };
      }),
    );
    // Invalidates BOTH tags: the fine-grained per-product tag (pages that
    // already contained this product) and the tenant-wide tag (pages that
    // don't contain it yet but might start matching it after this write —
    // e.g. status draft -> active newly qualifying for a ?status=active
    // page). update() can't tell which fields changed without a field-diff
    // against the pre-update row, so it treats every update as potentially
    // filter-relevant rather than leaving a narrow, hard-to-reason-about
    // staleness window. Was previously fine-grained only, deliberately
    // accepting that gap — see products-cache.ts's productsAllListsTag()
    // comment for the full history; closed here at the cost of evicting
    // every cached list page for the tenant on any single product edit,
    // not just the ones the product was already on.
    if (updated) {
      await this.cache.invalidateTag(productTag(tenantId, id));
      await this.cache.invalidateTag(productsAllListsTag(tenantId));
    }
    return updated;
  }

  /** Soft delete — sets deletedAt rather than removing the row, so an
   * order's own line-item snapshot never dangles on a hard-deleted
   * product, and the action is reversible at the database level even
   * though there's no restore endpoint today. Every read path filters
   * deletedAt IS NULL (see buildFilters/findById), so a soft-deleted
   * product behaves as gone through the API. Idempotent-safe: deleting an
   * already-deleted (or nonexistent) id matches zero rows and returns
   * null, same as a genuine 404, rather than erroring. */
  async delete(tenantId: string, id: string) {
    const deleted = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx
          .update(products)
          .set({ deletedAt: new Date() })
          .where(and(eq(products.id, id), isNull(products.deletedAt)))
          .returning();
        return product ?? null;
      }),
    );
    // Fine-grained, and fully correct here (unlike update()) — removing a
    // product only affects cached pages that already contained it; a page
    // that never had it is unaffected either way, no filter-shift concern.
    if (deleted) await this.cache.invalidateTag(productTag(tenantId, id));
    return deleted;
  }
}
