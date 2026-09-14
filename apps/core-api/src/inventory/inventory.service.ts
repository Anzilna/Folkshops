import { ConflictException, Injectable } from "@nestjs/common";
import { and, count, eq, ilike, isNull, SQL } from "drizzle-orm";
import { bulkImport, BulkImportResult } from "../common/bulk-import.util";
import { CsvColumn, toCsv } from "../common/csv.util";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../common/pagination.util";
import { DbRouter } from "../database/db-router";
import { inventory, products } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CreateInventoryDto } from "./dto/create-inventory.dto";
import { ImportInventoryRowDto } from "./dto/import-inventory-row.dto";
import { QueryInventoryDto } from "./dto/query-inventory.dto";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";

interface InventoryRow {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  isActive: boolean;
  updatedAt: Date;
}

const SORT_COLUMNS = {
  quantity: inventory.quantity,
  updatedAt: inventory.updatedAt,
  productName: products.name,
} as const;

function buildFilters(tenantId: string, query: QueryInventoryDto): SQL | undefined {
  const clauses = [eq(inventory.tenantId, tenantId), isNull(inventory.deletedAt)];
  if (query.isActive !== undefined) clauses.push(eq(inventory.isActive, query.isActive));
  if (query.search) clauses.push(ilike(products.name, `%${query.search}%`));
  return and(...clauses);
}

const EXPORT_COLUMNS: CsvColumn<InventoryRow>[] = [
  { key: "productId", header: "productId" },
  { key: "productName", header: "productName" },
  { key: "quantity", header: "quantity" },
  { key: "isActive", header: "isActive" },
];

/**
 * Staff-only, no public read — unlike products/categories there's no
 * storefront caller for exact stock counts yet, so there's no public
 * endpoint to build. "strong" reads throughout, deliberately not cached:
 * a merchant checking stock right after adjusting it should see the
 * adjustment immediately, and staleness here is a much worse failure mode
 * than on catalog browsing (over-promising stock that's already gone).
 *
 * Real CRUD, not one upsert-everything method: create() and update() are
 * separate, matching products/categories/customers — see each method's
 * own comment for exactly how they differ and why. list()/exportCsv()
 * join products for productName — inventory rows are meaningless without
 * knowing which product they're for. Quantity itself is still a plain
 * overwrite, not an atomic increment/decrement — see inventory.ts
 * schema comment on why this isn't a reservation system.
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
      isActive: inventory.isActive,
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
            isActive: inventory.isActive,
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

  /** Forgiving upsert, unlike create() below — a CSV re-import shouldn't
   * fail a row just because it was already imported once. Also revives a
   * soft-deleted row rather than leaving it shadowed by a fresh insert,
   * which the unique index on productId wouldn't even allow. */
  async importRows(tenantId: string, rows: Record<string, string>[]): Promise<BulkImportResult> {
    return bulkImport(rows, ImportInventoryRowDto, async (dto) => {
      const result = await this.upsert(tenantId, dto.productId, dto.quantity, dto.isActive ?? true);
      // upsert() returns null for a productId that isn't this tenant's —
      // bulkImport only treats a thrown error as a failed row, so a null
      // result must be turned into one, or a row referencing a bad
      // product id would silently count as a success.
      if (!result) throw new Error(`No product with id ${dto.productId} in this store`);
      return result;
    });
  }

  async findByProductId(tenantId: string, productId: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .select()
          .from(inventory)
          .where(and(eq(inventory.productId, productId), isNull(inventory.deletedAt)))
          .limit(1);
        return row ?? null;
      }),
    );
  }

  /** Insert-or-revive, shared by create() (which conflict-checks first)
   * and importRows() (which doesn't). Returns null if the product itself
   * doesn't exist for this tenant, so a caller can't create inventory
   * pointing at another tenant's product id (RLS scopes the inventory
   * row's own tenant_id, but doesn't stop that cross-tenant reference by
   * itself — this existence check is what does). */
  private async upsert(tenantId: string, productId: string, quantity: number, isActive = true) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
        if (!product) return null;

        // The unique index is on productId alone (no deletedAt), so a
        // soft-deleted row's slot has to be revived rather than a new one
        // inserted — see inventory.ts schema comment.
        const [existing] = await tx.select().from(inventory).where(eq(inventory.productId, productId)).limit(1);
        if (existing) {
          const [row] = await tx
            .update(inventory)
            .set({ quantity, isActive, deletedAt: null, updatedAt: new Date() })
            .where(eq(inventory.productId, productId))
            .returning();
          return row;
        }

        const [row] = await tx
          .insert(inventory)
          .values({ tenantId, productId, quantity, isActive })
          .returning();
        return row;
      }),
    );
  }

  /** Real create — errors instead of silently updating if an active
   * (non-deleted) row already exists for this product, unlike the
   * upsert() convenience importRows()/the merchant-admin quantity cell
   * use. A soft-deleted row for the same product is revived rather than
   * treated as a conflict, matching upsert()'s semantics — there's no
   * separate restore endpoint, creating again is how you get it back. */
  async create(tenantId: string, dto: CreateInventoryDto) {
    const existing = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .select({ id: inventory.id })
          .from(inventory)
          .where(and(eq(inventory.productId, dto.productId), isNull(inventory.deletedAt)))
          .limit(1);
        return row ?? null;
      }),
    );
    if (existing) throw new ConflictException("This product already has an inventory record");
    return this.upsert(tenantId, dto.productId, dto.quantity, dto.isActive ?? true);
  }

  /** Requires an existing, non-deleted row — unlike upsert(), this never
   * creates one. Partial: only the fields present in dto are changed. */
  async update(tenantId: string, productId: string, dto: UpdateInventoryDto) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .update(inventory)
          .set({ ...dto, updatedAt: new Date() })
          .where(and(eq(inventory.productId, productId), isNull(inventory.deletedAt)))
          .returning();
        return row ?? null;
      }),
    );
  }

  /** Soft delete — see ProductsService.delete()'s comment for why. */
  async delete(tenantId: string, productId: string) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .update(inventory)
          .set({ deletedAt: new Date() })
          .where(and(eq(inventory.productId, productId), isNull(inventory.deletedAt)))
          .returning();
        return row ?? null;
      }),
    );
  }
}
