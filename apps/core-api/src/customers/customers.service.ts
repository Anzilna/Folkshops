import { Injectable } from "@nestjs/common";
import { and, count, eq, or, ilike, SQL } from "drizzle-orm";
import { bulkImport, BulkImportResult } from "../common/bulk-import.util";
import { CsvColumn, toCsv } from "../common/csv.util";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../common/pagination.util";
import { DbRouter } from "../database/db-router";
import { customers } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { QueryCustomersDto } from "./dto/query-customers.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

const SORT_COLUMNS = {
  name: customers.name,
  phone: customers.phone,
  createdAt: customers.createdAt,
} as const;

function buildFilters(tenantId: string, query: QueryCustomersDto): SQL | undefined {
  const clauses = [eq(customers.tenantId, tenantId)];
  if (query.search) {
    clauses.push(or(ilike(customers.phone, `%${query.search}%`), ilike(customers.name, `%${query.search}%`))!);
  }
  return and(...clauses);
}

const EXPORT_COLUMNS: CsvColumn<typeof customers.$inferSelect>[] = [
  { key: "id", header: "id" },
  { key: "phone", header: "phone" },
  { key: "name", header: "name" },
  { key: "createdAt", header: "createdAt", value: (row) => row.createdAt.toISOString() },
];

/**
 * Staff-facing customer management — didn't exist before this pass, only
 * the customer-auth surface (customer-auth.service.ts) that creates these
 * rows via OTP verification. Same list/export/import shape as the other
 * modules; see ProductsService for the reasoning behind it.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly dbRouter: DbRouter) {}

  async create(tenantId: string, input: CreateCustomerDto) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [customer] = await tx
          .insert(customers)
          .values({ tenantId, ...input })
          .returning();
        return customer;
      }),
    );
  }

  async list(tenantId: string, query: QueryCustomersDto): Promise<PaginatedResult<typeof customers.$inferSelect>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    return this.dbRouter.read("eventual", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [rows, [{ total }]] = await Promise.all([
          tx.select().from(customers).where(where).orderBy(orderBy).limit(limit).offset(offsetFor(page, limit)),
          tx.select({ total: count() }).from(customers).where(where),
        ]);
        return paginatedResult(rows, total, page, limit);
      }),
    );
  }

  async exportCsv(tenantId: string, query: QueryCustomersDto): Promise<string> {
    const where = buildFilters(tenantId, query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    const rows = await this.dbRouter.read("eventual", (db) =>
      withTenantContext(db, tenantId, async (tx) => tx.select().from(customers).where(where).orderBy(orderBy)),
    );
    return toCsv(rows, EXPORT_COLUMNS);
  }

  async importRows(tenantId: string, rows: Record<string, string>[]): Promise<BulkImportResult> {
    return bulkImport(rows, CreateCustomerDto, (dto) => this.create(tenantId, dto));
  }

  async findById(tenantId: string, id: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [customer] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
        return customer ?? null;
      }),
    );
  }

  async update(tenantId: string, id: string, input: UpdateCustomerDto) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [customer] = await tx
          .update(customers)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(customers.id, id))
          .returning();
        return customer ?? null;
      }),
    );
  }

  async delete(tenantId: string, id: string) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [customer] = await tx.delete(customers).where(eq(customers.id, id)).returning();
        return customer ?? null;
      }),
    );
  }
}
