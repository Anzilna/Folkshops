import { Injectable } from "@nestjs/common";
import { and, count, eq, ilike, SQL } from "drizzle-orm";
import { bulkImport, BulkImportResult } from "../common/bulk-import.util";
import { CsvColumn, toCsv } from "../common/csv.util";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../common/pagination.util";
import { DbRouter } from "../database/db-router";
import { inventory, products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { ImportInventoryRowDto } from "./dto/import-inventory-row.dto";
import { QueryInventoryDto } from "./dto/query-inventory.dto";

interface InventoryRow {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  updatedAt: Date;
}

const SORT_COLUMNS = {
  quantity: inventory.quantity,
  updatedAt: inventory.updatedAt,
  productName: products.name,
} as const;

function buildFilters(tenantId: string, query: QueryInventoryDto): SQL | undefined {
  const clauses = [eq(inventory.tenantId, tenantId)];
  if (query.search) clauses.push(ilike(products.name, `%${query.search}%`));
  return and(...clauses);
}

const EXPORT_COLUMNS: CsvColumn<InventoryRow>[] = [
  { key: "productId", header: "productId" },
  { key: "productName", header: "productName" },
  { key: "quantity", header: "quantity" },
];

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
 * list()/exportCsv() join products for productName — inventory rows are
 * meaningless without knowing which product they're for.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly dbRouter: DbRouter) {}

  async list(tenantId: string, query: QueryInventoryDto): Promise<PaginatedResult<InventoryRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "updatedAt");
    const selection = {
      id: inventory.id,
      productId: inventory.productId,
      productName: products.name,
      quantity: inventory.quantity,
      updatedAt: inventory.updatedAt,
    };

    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const base = tx.select(selection).from(inventory).innerJoin(products, eq(inventory.productId, products.id));
        const countBase = tx.select({ total: count() }).from(inventory).innerJoin(products, eq(inventory.productId, products.id));

        const [rows, [{ total }]] = await Promise.all([
          base.where(where).orderBy(orderBy).limit(limit).offset(offsetFor(page, limit)),
          countBase.where(where),
        ]);
        return paginatedResult(rows, total, page, limit);
      }),
    );
  }

  async exportCsv(tenantId: string, query: QueryInventoryDto): Promise<string> {
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "updatedAt");

    const rows = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) =>
        tx
          .select({
            id: inventory.id,
            productId: inventory.productId,
            productName: products.name,
            quantity: inventory.quantity,
            updatedAt: inventory.updatedAt,
          })
          .from(inventory)
          .innerJoin(products, eq(inventory.productId, products.id))
          .where(where)
          .orderBy(orderBy),
      ),
    );
    return toCsv(rows, EXPORT_COLUMNS);
  }

  async importRows(tenantId: string, rows: Record<string, string>[]): Promise<BulkImportResult> {
    return bulkImport(rows, ImportInventoryRowDto, async (dto) => {
      const result = await this.setQuantity(tenantId, dto.productId, dto.quantity);
      // setQuantity() returns null for a productId that isn't this
      // tenant's — bulkImport only treats a thrown error as a failed row,
      // so a null result must be turned into one, or a row referencing a
      // bad product id would silently count as a success.
      if (!result) throw new Error(`No product with id ${dto.productId} in this store`);
      return result;
    });
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
