import { Injectable } from "@nestjs/common";
import { and, count, eq, ilike, or, SQL } from "drizzle-orm";
import { CsvColumn, toCsv } from "../common/csv.util";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../common/pagination.util";
import { DbRouter } from "../database/db-router";
import { tenants } from "../database/schema";
import { QueryTenantsDto } from "./dto/query-tenants.dto";

const SORT_COLUMNS = {
  name: tenants.name,
  slug: tenants.slug,
  status: tenants.status,
  createdAt: tenants.createdAt,
} as const;

function buildFilters(query: QueryTenantsDto): SQL | undefined {
  const clauses: SQL[] = [];
  if (query.status) clauses.push(eq(tenants.status, query.status));
  if (query.search) {
    clauses.push(or(ilike(tenants.name, `%${query.search}%`), ilike(tenants.slug, `%${query.search}%`))!);
  }
  return clauses.length > 0 ? and(...clauses) : undefined;
}

const EXPORT_COLUMNS: CsvColumn<typeof tenants.$inferSelect>[] = [
  { key: "id", header: "id" },
  { key: "name", header: "name" },
  { key: "slug", header: "slug" },
  { key: "status", header: "status" },
  { key: "createdAt", header: "createdAt", value: (row) => row.createdAt.toISOString() },
];

@Injectable()
export class TenantsService {
  constructor(private readonly dbRouter: DbRouter) {}

  /**
   * Runs on every request (TenantResolverMiddleware) and resolves the
   * tenant-isolation trust boundary for that request. Kept "strong" rather
   * than promoted to "eventual" even though tenant registry data changes
   * rarely — a stale read here would affect which store's data the rest
   * of the request can touch, not just page content.
   */
  async findBySlug(slug: string) {
    return this.dbRouter.read("strong", async (db) => {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
      return tenant ?? null;
    });
  }

  /**
   * Platform-admin only (see PlatformAdminTenantsController) — the global
   * tenant registry, not scoped to any one tenant. `tenants` itself has no
   * RLS (it's the registry RLS policies key off of), so this is a plain
   * query, no withTenantContext.
   */
  async list(query: QueryTenantsDto): Promise<PaginatedResult<typeof tenants.$inferSelect>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = buildFilters(query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    return this.dbRouter.read("strong", async (db) => {
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(tenants).where(where).orderBy(orderBy).limit(limit).offset(offsetFor(page, limit)),
        db.select({ total: count() }).from(tenants).where(where),
      ]);
      return paginatedResult(rows, total, page, limit);
    });
  }

  /** No importRows() — a tenant is provisioned by a merchant registering
   * (POST /auth/register), not by a platform admin bulk-uploading a CSV.
   * Export stays (platform-admin reporting is legitimate), import doesn't
   * correspond to anything real. */
  async exportCsv(query: QueryTenantsDto): Promise<string> {
    const where = buildFilters(query);
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    const rows = await this.dbRouter.read("strong", async (db) =>
      db.select().from(tenants).where(where).orderBy(orderBy),
    );
    return toCsv(rows, EXPORT_COLUMNS);
  }
}
