import { Injectable } from "@nestjs/common";
import { asc } from "drizzle-orm";
import { offsetFor, paginatedResult, PaginatedResult } from "../../common/pagination.util";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { DbRouter } from "../../database/db-router";
import { plans } from "../../database/schema";
import { PlatformAdminDashboardService } from "../dashboard/platform-admin-dashboard.service";

export class QueryPlansDto extends PaginationQueryDto {}

export interface PlanRow {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  currency: string;
  maxProducts: number | null;
  aiAccess: boolean;
  isActive: boolean;
  /** Whether a Stripe Price exists for it (checkout needs one). The id itself never leaves the server. */
  billable: boolean;
  activeSubscribers: number;
  totalSubscriptions: number;
}

/**
 * Read-only on purpose. A plan's price is bound to an immutable Stripe
 * Price object (new price = new Price id), so editing one is a billing
 * operation owned by scripts/bootstrap-stripe-plans.ts, not a form field.
 */
@Injectable()
export class PlatformAdminPlansService {
  constructor(
    private readonly dbRouter: DbRouter,
    private readonly dashboard: PlatformAdminDashboardService,
  ) {}

  async list(query: QueryPlansDto): Promise<PaginatedResult<PlanRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const rows = await this.dbRouter.read("strong", (db) => db.select().from(plans).orderBy(asc(plans.priceCents)));
    const { subscriptionByTenantId } = await this.dashboard.loadSubscriptionSnapshot();

    const active = new Map<string, number>();
    const total = new Map<string, number>();
    for (const sub of subscriptionByTenantId.values()) {
      total.set(sub.planSlug, (total.get(sub.planSlug) ?? 0) + 1);
      if (sub.status === "active") active.set(sub.planSlug, (active.get(sub.planSlug) ?? 0) + 1);
    }

    const all: PlanRow[] = rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      priceCents: p.priceCents,
      currency: p.currency,
      maxProducts: p.maxProducts,
      aiAccess: p.aiAccess,
      isActive: p.isActive,
      billable: p.priceCents === 0 || Boolean(p.stripePriceId),
      activeSubscribers: active.get(p.slug) ?? 0,
      totalSubscriptions: total.get(p.slug) ?? 0,
    }));
    return paginatedResult(all.slice(offsetFor(page, limit), offsetFor(page, limit) + limit), all.length, page, limit);
  }
}
