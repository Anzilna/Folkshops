import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import type Redis from "ioredis";
import { count, eq, ilike, or, SQL } from "drizzle-orm";
import { TokenService } from "../../auth/token.service";
import { offsetFor, paginatedResult, PaginatedResult, resolveSort } from "../../common/pagination.util";
import { DbRouter } from "../../database/db-router";
import { platformAdmins } from "../../database/schema";
import { REDIS_CLIENT } from "../../redis/tokens";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { publishDashboardUpdate } from "../dashboard/platform-admin-realtime";
import { PlatformAdminsService } from "../platform-admins.service";
import { ChangePasswordDto, CreatePlatformAdminDto, QueryPlatformAdminsDto } from "./platform-admin-team.dto";

const PASSWORD_HASH_ROUNDS = 10;
type Admin = { sub: string; email: string };

const SORT_COLUMNS = {
  name: platformAdmins.name,
  email: platformAdmins.email,
  createdAt: platformAdmins.createdAt,
  lastLoginAt: platformAdmins.lastLoginAt,
} as const;

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  lastLoginAt: string | null;
  createdAt: string;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Every platform admin is equal today (no roles — see CLAUDE.md's deferred
 * list), so any admin may add or remove another. There is no password-
 * reset email or invitation flow: the creating admin sets a first password
 * and hands it over, and the new admin changes it in Settings. That matches
 * "internal staff, provisioned by an operator" rather than a public signup.
 */
@Injectable()
export class PlatformAdminTeamService {
  constructor(
    private readonly dbRouter: DbRouter,
    private readonly admins: PlatformAdminsService,
    private readonly audit: PlatformAuditService,
    private readonly tokens: TokenService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async list(query: QueryPlatformAdminsDto): Promise<PaginatedResult<TeamMember>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const clauses: SQL[] = [];
    if (query.search) clauses.push(or(ilike(platformAdmins.email, `%${query.search}%`), ilike(platformAdmins.name, `%${query.search}%`))!);
    const where = clauses[0];
    const orderBy = resolveSort(query.sortBy, query.sortDir, SORT_COLUMNS, "createdAt");

    return this.dbRouter.read("strong", async (db) => {
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(platformAdmins).where(where).orderBy(orderBy).limit(limit).offset(offsetFor(page, limit)),
        db.select({ total: count() }).from(platformAdmins).where(where),
      ]);
      return paginatedResult(
        rows.map((r) => ({
          id: r.id,
          email: r.email,
          name: r.name,
          lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        page,
        limit,
      );
    });
  }

  async create(actor: Admin, dto: CreatePlatformAdminDto): Promise<TeamMember> {
    const email = dto.email.toLowerCase();
    if (await this.admins.findByEmail(email)) throw new ConflictException("A platform admin with that email already exists");

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS);
    try {
      const created = await this.dbRouter.write((db) =>
        db.transaction(async (tx) => {
          const [row] = await tx.insert(platformAdmins).values({ email, name: dto.name, passwordHash }).returning();
          await this.audit.record(tx, actor, { action: "admin.created", targetType: "admin", targetId: row.id, targetLabel: row.email });
          return row;
        }),
      );
      void publishDashboardUpdate(this.redis); // refreshes every admin's activity bell
      return { id: created.id, email: created.email, name: created.name, lastLoginAt: null, createdAt: created.createdAt.toISOString() };
    } catch (err) {
      // The pre-check above isn't atomic; the unique index is the real guard.
      if (isUniqueViolation(err)) throw new ConflictException("A platform admin with that email already exists");
      throw err;
    }
  }

  /**
   * Hard delete: nothing references a platform admin (the audit log stores
   * the email as a snapshot instead), and a removed account must not be
   * able to come back. All admins are locked FOR UPDATE first, so two
   * admins removing each other at the same instant serialize and the second
   * is refused — the platform can never end up with zero admins.
   */
  async remove(actor: Admin, id: string): Promise<void> {
    if (id === actor.sub) throw new BadRequestException("You can't remove your own account — ask another admin to do it.");

    await this.dbRouter.write((db) =>
      db.transaction(async (tx) => {
        // ORDER BY id: every remover locks the rows in the same order, so
        // two of them can wait on each other's locks but never deadlock.
        const all = await tx
          .select({ id: platformAdmins.id, email: platformAdmins.email })
          .from(platformAdmins)
          .orderBy(platformAdmins.id)
          .for("update");
        const target = all.find((a) => a.id === id);
        if (!target) throw new NotFoundException("Platform admin not found");
        if (all.length <= 1) throw new ConflictException("This is the last platform admin and can't be removed");

        await tx.delete(platformAdmins).where(eq(platformAdmins.id, id));
        await this.tokens.revokeAllForSubjectIn(tx, "platform_admin", id);
        await this.audit.record(tx, actor, { action: "admin.removed", targetType: "admin", targetId: id, targetLabel: target.email });
      }),
    );
    void publishDashboardUpdate(this.redis);
  }

  /** Verifies the current password, sets the new one, and signs the account out everywhere; the caller issues a fresh session for this browser. */
  async changePassword(adminId: string, input: ChangePasswordDto): Promise<void> {
    const admin = await this.admins.findById(adminId);
    if (!admin) throw new NotFoundException("Platform admin not found");
    if (!(await bcrypt.compare(input.currentPassword, admin.passwordHash))) {
      // 400, not 401: a wrong current password is a form error, not an expired session.
      throw new BadRequestException("Current password is incorrect");
    }
    if (input.currentPassword === input.newPassword) throw new BadRequestException("Choose a password different from the current one");

    const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_HASH_ROUNDS);
    await this.dbRouter.write((db) =>
      db.transaction(async (tx) => {
        await tx.update(platformAdmins).set({ passwordHash, updatedAt: new Date() }).where(eq(platformAdmins.id, adminId));
        await this.tokens.revokeAllForSubjectIn(tx, "platform_admin", adminId);
        await this.audit.record(tx, { sub: admin.id, email: admin.email }, {
          action: "admin.password_changed",
          targetType: "admin",
          targetId: admin.id,
          targetLabel: admin.email,
        });
      }),
    );
    void publishDashboardUpdate(this.redis);
  }
}
