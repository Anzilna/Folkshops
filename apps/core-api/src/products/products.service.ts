import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, ilike, SQL } from "drizzle-orm";
import { bulkImport, BulkImportResult } from "../common/bulk-import.util";
import { CsvColumn, toCsv } from "../common/csv.util";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../common/pagination.util";
import { DbRouter } from "../database/db-router";
import type { Db } from "../database/tokens";
import { productImages, products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CreateProductDto } from "./dto/create-product.dto";
import { QueryProductsDto } from "./dto/query-products.dto";
import { UpdateProductDto } from "./dto/update-product.dto";

const SORT_COLUMNS = {
  name: products.name,
  priceCents: products.priceCents,
  status: products.status,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
} as const;

function buildFilters(tenantId: string, query: QueryProductsDto): SQL | undefined {
  const clauses = [eq(products.tenantId, tenantId)];
  if (query.status) clauses.push(eq(products.status, query.status));
  if (query.categoryId) clauses.push(eq(products.categoryId, query.categoryId));
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
  constructor(private readonly dbRouter: DbRouter) {}

  async create(tenantId: string, input: CreateProductDto) {
    const { images, ...productInput } = input;
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({ tenantId, ...productInput })
          .returning();
        if (images) await replaceGallery(tx, tenantId, product.id, images);
        return { ...product, images: images ?? [] };
      }),
    );
  }

  /**
   * Paginated/sorted/filtered — "eventual" (replica-tolerant, same
   * reasoning as before: this is catalog browsing, non-critical staleness).
   * Deliberately NOT cached, unlike the pre-pagination version of this
   * method: caching was viable for exactly one query shape ("all products,
   * no filters"), but every page/sort/filter combination is a distinct
   * cache key, and CacheService only supports deleting one exact key on
   * invalidate() — there's no wildcard delete, so a write could never
   * cleanly invalidate every cached variant. A merchant filtering their
   * own products right after editing one and seeing stale results would be
   * a worse regression than losing a 30s cache on a read that already hits
   * the replica.
   */
  async list(tenantId: string, query: QueryProductsDto): Promise<PaginatedResult<typeof products.$inferSelect>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    return this.dbRouter.read("eventual", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [rows, [{ total }]] = await Promise.all([
          tx.select().from(products).where(where).orderBy(orderBy).limit(limit).offset(offsetFor(page, limit)),
          tx.select({ total: count() }).from(products).where(where),
        ]);
        return paginatedResult(rows, total, page, limit);
      }),
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
        const [product] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
        if (!product) return null;
        const gallery = await tx.select().from(productImages).where(eq(productImages.productId, id)).orderBy(asc(productImages.position));
        return { ...product, images: gallery.map((g) => g.url) };
      }),
    );
  }

  async update(tenantId: string, id: string, input: UpdateProductDto) {
    const { images, ...productInput } = input;
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx
          .update(products)
          .set({ ...productInput, updatedAt: new Date() })
          .where(eq(products.id, id))
          .returning();
        if (!product) return null;
        if (images) await replaceGallery(tx, tenantId, id, images);
        const gallery = await tx.select().from(productImages).where(eq(productImages.productId, id)).orderBy(asc(productImages.position));
        return { ...product, images: gallery.map((g) => g.url) };
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
