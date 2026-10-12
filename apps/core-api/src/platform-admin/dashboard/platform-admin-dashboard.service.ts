import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../../database/db-router";
import { plans, subscriptions, tenants } from "../../database/schema";
import { withTenantContext } from "../../database/tenant-context";

export interface PlatformDashboardSummary {
  tenantCounts: { active: number; suspended: number; total: number };
  subscriptionsByStatus: Record<"incomplete" | "active" | "past_due" | "canceled", number>;
  subscriptionsByPlan: { planSlug: string; planName: string; count: number }[];
  mrrCents: number;
  recentTenants: { id: string; name: string; slug: string; status: string; createdAt: string; planName: string | null }[];
}

export interface SubscriptionSnapshot {
  status: "incomplete" | "active" | "past_due" | "canceled";
  planSlug: string;
  planName: string;
  priceCents: number;
}

const RECENT_TENANTS_LIMIT = 10;

/**
 * `subscriptions` is RLS-protected (tenant-owned, correctly — see its own
 * schema comment); `tenants` is not. Aggregating "every tenant's
 * subscription" for a platform-wide dashboard therefore can't be one plain
 * query the way PlatformAdminTenantsController's tenant list is — there is
 * no single `app.tenant_id` that would make RLS show every row at once,
 * and giving the app role BYPASSRLS just for this would undermine the
 * exact isolation guarantee RLS exists for everywhere else (CLAUDE.md's
 * "the Postgres role must never be a superuser/bypass" rule extends to
 * "never grant a blanket bypass for one feature's convenience").
 *
 * Instead: fetch the (non-RLS) tenant list once, then run one
 * `withTenantContext` read per tenant concurrently and aggregate in
 * application code. Fine at the current/foreseeable tenant count (tens to
 * low hundreds) — a real bottleneck at thousands of tenants, at which
 * point this would need a denormalized read model instead. Documented
 * here rather than solved speculatively now (rule 30: don't over-engineer
 * ahead of an actual scale problem).
 */
@Injectable()
export class PlatformAdminDashboardService {
  constructor(private readonly dbRouter: DbRouter) {}

  /**
   * Every tenant plus each one's subscription, gathered tenant by tenant
   * (see the class comment for why). Shared with the plans page so the
   * per-tenant fan-out lives in exactly one place.
   */
  async loadSubscriptionSnapshot(): Promise<{
    tenants: (typeof tenants.$inferSelect)[];
    subscriptionByTenantId: Map<string, SubscriptionSnapshot>;
  }> {
    const allTenants = await this.dbRouter.read("eventual", (db) => db.select().from(tenants));

    const subscriptionByTenantId = new Map<string, SubscriptionSnapshot>();
    await Promise.all(
      allTenants.map(async (tenant) => {
        const row = await this.dbRouter.read("eventual", (db) =>
          withTenantContext(db, tenant.id, async (tx) => {
            const [r] = await tx
              .select({
                status: subscriptions.status,
                planSlug: plans.slug,
                planName: plans.name,
                priceCents: plans.priceCents,
              })
              .from(subscriptions)
              .innerJoin(plans, eq(subscriptions.planId, plans.id))
              .where(eq(subscriptions.tenantId, tenant.id))
              .limit(1);
            return r ?? null;
          }),
        );
        if (row) subscriptionByTenantId.set(tenant.id, row);
      }),
    );
    return { tenants: allTenants, subscriptionByTenantId };
  }

  async getSummary(): Promise<PlatformDashboardSummary> {
    const { tenants: allTenants, subscriptionByTenantId } = await this.loadSubscriptionSnapshot();

    const active = allTenants.filter((t) => t.status === "active").length;
    const suspended = allTenants.filter((t) => t.status === "suspended").length;

    const subscriptionsByStatus: PlatformDashboardSummary["subscriptionsByStatus"] = {
      incomplete: 0,
      active: 0,
      past_due: 0,
      canceled: 0,
    };
    const planCounts = new Map<string, { planName: string; count: number }>();
    let mrrCents = 0;

    for (const row of subscriptionByTenantId.values()) {
      subscriptionsByStatus[row.status] += 1;
      const existing = planCounts.get(row.planSlug);
      planCounts.set(row.planSlug, { planName: row.planName, count: (existing?.count ?? 0) + 1 });
      // Only a currently-active paid subscription counts toward MRR — an
      // incomplete/past_due/canceled one isn't recognized revenue.
      if (row.status === "active") mrrCents += row.priceCents;
    }

    const recentTenants = [...allTenants]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, RECENT_TENANTS_LIMIT)
      .map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        createdAt: tenant.createdAt.toISOString(),
        planName: subscriptionByTenantId.get(tenant.id)?.planName ?? null,
      }));

    return {
      tenantCounts: { active, suspended, total: allTenants.length },
      subscriptionsByStatus,
      subscriptionsByPlan: [...planCounts.entries()].map(([planSlug, v]) => ({ planSlug, planName: v.planName, count: v.count })),
      mrrCents,
      recentTenants,
    };
  }
}
