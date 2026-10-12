import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, ilike, or, SQL } from "drizzle-orm";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../../common/pagination.util";
import { DbRouter } from "../../database/db-router";
import { platformAuditLog, type PlatformAuditAction } from "../../database/schema";
import type { Db } from "../../database/tokens";
import { QueryAuditLogDto } from "./query-audit-log.dto";

export interface AuditEntry {
  action: PlatformAuditAction;
  targetType: "tenant" | "admin";
  targetId: string;
  /** Snapshot of the target's name/email, so the log still reads correctly after it is renamed or removed. */
  targetLabel: string;
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  tenantId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const SORT_COLUMNS = {
  createdAt: platformAuditLog.createdAt,
  action: platformAuditLog.action,
  adminEmail: platformAuditLog.adminEmail,
} as const;

function toRow(r: typeof platformAuditLog.$inferSelect): AuditRow {
  return {
    id: r.id,
    adminEmail: r.adminEmail,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetLabel,
    tenantId: r.tenantId,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Append-only: there is deliberately no update or delete here. record()
 * takes the caller's transaction so the log entry commits or rolls back
 * together with the action it describes — an action can never happen
 * without its record, or leave a record of something that didn't happen.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly dbRouter: DbRouter) {}

  async record(tx: Db, admin: { sub: string; email: string }, entry: AuditEntry): Promise<void> {
    await tx.insert(platformAuditLog).values({
      adminId: admin.sub,
      adminEmail: admin.email,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetLabel: entry.targetLabel,
      tenantId: entry.tenantId ?? null,
      metadata: entry.metadata ?? {},
    });
  }

  async list(query: QueryAuditLogDto): Promise<PaginatedResult<AuditRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const clauses: SQL[] = [];
    if (query.action) clauses.push(eq(platformAuditLog.action, query.action));
    if (query.search) {
      clauses.push(or(ilike(platformAuditLog.adminEmail, `%${query.search}%`), ilike(platformAuditLog.targetLabel, `%${query.search}%`))!);
    }
    const where = clauses.length > 0 ? and(...clauses) : undefined;
    // Newest first unless the caller chose a sort. PaginationQueryDto
    // defaults sortDir to "asc", so "no sortDir given" can't be told apart
    // from "asc requested" — only an explicit sortBy means the caller is
    // choosing the order.
    const orderBy = resolveSort(query.sortBy, query.sortBy ? query.sortDir : "desc", SORT_COLUMNS, "createdAt");

    return this.dbRouter.read("strong", async (db) => {
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(platformAuditLog).where(where).orderBy(orderBy).limit(limit).offset(offsetFor(page, limit)),
        db.select({ total: count() }).from(platformAuditLog).where(where),
      ]);
      return paginatedResult(rows.map(toRow), total, page, limit);
    });
  }

  async recent(limit: number, tenantId?: string): Promise<AuditRow[]> {
    const rows = await this.dbRouter.read("strong", (db) =>
      db
        .select()
        .from(platformAuditLog)
        .where(tenantId ? eq(platformAuditLog.tenantId, tenantId) : undefined)
        .orderBy(desc(platformAuditLog.createdAt))
        .limit(limit),
    );
    return rows.map(toRow);
  }
}
