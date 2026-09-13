import { Injectable } from "@nestjs/common";
import { and, count, eq, ilike, SQL } from "drizzle-orm";
import { bulkImport, BulkImportResult } from "../common/bulk-import.util";
import { CsvColumn, toCsv } from "../common/csv.util";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../common/pagination.util";
import { DbRouter } from "../database/db-router";
import { categories } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { QueryCategoriesDto } from "./dto/query-categories.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

const SORT_COLUMNS = {
  name: categories.name,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
} as const;

function buildFilters(tenantId: string, query: QueryCategoriesDto): SQL | undefined {
  const clauses = [eq(categories.tenantId, tenantId)];
  if (query.search) clauses.push(ilike(categories.name, `%${query.search}%`));
  return and(...clauses);
}

const EXPORT_COLUMNS: CsvColumn<typeof categories.$inferSelect>[] = [
  { key: "id", header: "id" },
  { key: "name", header: "name" },
  { key: "slug", header: "slug" },
  { key: "description", header: "description" },
];

/** Same shape as ProductsService throughout — see that file's comments
 * for the reasoning behind the pagination/sort/filter/export/import
 * design and why list() isn't cached. */
@Injectable()
export class CategoriesService {
  constructor(private readonly dbRouter: DbRouter) {}

  async create(tenantId: string, input: CreateCategoryDto) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [category] = await tx
          .insert(categories)
          .values({ tenantId, ...input })
          .returning();
        return category;
      }),
    );
  }

  async list(tenantId: string, query: QueryCategoriesDto): Promise<PaginatedResult<typeof categories.$inferSelect>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    return this.dbRouter.read("eventual", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [rows, [{ total }]] = await Promise.all([
          tx.select().from(categories).where(where).orderBy(orderBy).limit(limit).offset(offsetFor(page, limit)),
          tx.select({ total: count() }).from(categories).where(where),
        ]);
        return paginatedResult(rows, total, page, limit);
      }),
    );
  }

  async exportCsv(tenantId: string, query: QueryCategoriesDto): Promise<string> {
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    const rows = await this.dbRouter.read("eventual", (db) =>
      withTenantContext(db, tenantId, async (tx) => tx.select().from(categories).where(where).orderBy(orderBy)),
    );
    return toCsv(rows, EXPORT_COLUMNS);
  }

  async importRows(tenantId: string, rows: Record<string, string>[]): Promise<BulkImportResult> {
    return bulkImport(rows, CreateCategoryDto, (dto) => this.create(tenantId, dto));
  }

  async findById(tenantId: string, id: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [category] = await tx.select().from(categories).where(eq(categories.id, id)).limit(1);
        return category ?? null;
      }),
    );
  }

  async update(tenantId: string, id: string, input: UpdateCategoryDto) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [category] = await tx
          .update(categories)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(categories.id, id))
          .returning();
        return category ?? null;
      }),
    );
  }

  async delete(tenantId: string, id: string) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [category] = await tx.delete(categories).where(eq(categories.id, id)).returning();
        return category ?? null;
      }),
    );
  }
}
