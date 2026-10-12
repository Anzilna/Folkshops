import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { DbRouter } from "../../database/db-router";
import {
  customers,
  memberships,
  orders,
  paymentAccounts,
  plans,
  products,
  refreshTokens,
  subscriptions,
  tenants,
  users,
} from "../../database/schema";
import { withTenantContext } from "../../database/tenant-context";
import { REDIS_CLIENT } from "../../redis/tokens";
import type { QueryTenantsDto } from "../../tenants/dto/query-tenants.dto";
import { TenantsService } from "../../tenants/tenants.service";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { publishDashboardUpdate } from "../dashboard/platform-admin-realtime";

type Admin = { sub: string; email: string };

/**
 * Cross-tenant reads for the platform admin. `tenants` has no RLS but
 * everything about a store's own data (subscription, owners, usage, payment
 * account) does, so each store is read under its own withTenantContext —
 * never a blanket RLS bypass for the admin's convenience (see
 * PlatformAdminDashboardService's comment for the full reasoning).
 */
@Injectable()
export class PlatformAdminTenantsService {
  constructor(
    private readonly dbRouter: DbRouter,
    private readonly tenants: TenantsService,
    private readonly audit: PlatformAuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** The standard paginated tenant list, plus each store's plan and subscription status for the page's rows. */
  async list(query: QueryTenantsDto) {
    const page = await this.tenants.list(query);
    const subs = await Promise.all(page.data.map((t) => this.subscriptionOf(t.id)));
    return {
      ...page,
      data: page.data.map((t, i) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        suspendedAt: t.suspendedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        planName: subs[i]?.planName ?? null,
        subscriptionStatus: subs[i]?.status ?? null,
      })),
    };
  }

  private async subscriptionOf(tenantId: string) {
    return this.dbRouter.read("eventual", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .select({ planName: plans.name, status: subscriptions.status })
          .from(subscriptions)
          .innerJoin(plans, eq(subscriptions.planId, plans.id))
          .where(eq(subscriptions.tenantId, tenantId))
          .limit(1);
        return row ?? null;
      }),
    );
  }

  async getDetail(id: string) {
    const tenant = await this.tenants.findById(id);
    if (!tenant) throw new NotFoundException("Store not found");

    const details = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, id, async (tx) => {
        const [subscription] = await tx
          .select({
            status: subscriptions.status,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            planName: plans.name,
            planSlug: plans.slug,
            priceCents: plans.priceCents,
            currency: plans.currency,
            aiAccess: plans.aiAccess,
            maxProducts: plans.maxProducts,
          })
          .from(subscriptions)
          .innerJoin(plans, eq(subscriptions.planId, plans.id))
          .where(eq(subscriptions.tenantId, id))
          .limit(1);

        const owners = await tx
          .select({ id: users.id, name: users.name, email: users.email })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .where(and(eq(memberships.tenantId, id), eq(memberships.role, "owner")));

        const [{ productCount }] = await tx
          .select({ productCount: count() })
          .from(products)
          .where(and(eq(products.tenantId, id), isNull(products.deletedAt)));
        const [{ customerCount }] = await tx
          .select({ customerCount: count() })
          .from(customers)
          .where(and(eq(customers.tenantId, id), isNull(customers.deletedAt)));
        const [orderStats] = await tx
          .select({
            orderCount: count(),
            paidOrders: sql<number>`count(*) filter (where ${orders.status} = 'paid')`.mapWith(Number),
            paidRevenueCents: sql<number>`coalesce(sum(${orders.subtotalCents}) filter (where ${orders.status} = 'paid'), 0)`.mapWith(Number),
          })
          .from(orders)
          .where(eq(orders.tenantId, id));

        const [payment] = await tx
          .select({
            live: paymentAccounts.live,
            payoutsEnabled: paymentAccounts.payoutsEnabled,
            detailsSubmitted: paymentAccounts.detailsSubmitted,
            activatedAt: paymentAccounts.activatedAt,
          })
          .from(paymentAccounts)
          .where(eq(paymentAccounts.tenantId, id))
          .limit(1);

        return { subscription: subscription ?? null, owners, productCount, customerCount, orderStats, payment: payment ?? null };
      }),
    );

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
        suspensionReason: tenant.suspensionReason,
        createdAt: tenant.createdAt.toISOString(),
      },
      subscription: details.subscription && {
        ...details.subscription,
        currentPeriodEnd: details.subscription.currentPeriodEnd?.toISOString() ?? null,
      },
      owners: details.owners,
      usage: {
        products: details.productCount,
        customers: details.customerCount,
        orders: details.orderStats.orderCount,
        paidOrders: details.orderStats.paidOrders,
        paidRevenueCents: details.orderStats.paidRevenueCents,
      },
      payments: details.payment && { ...details.payment, activatedAt: details.payment.activatedAt?.toISOString() ?? null },
      history: await this.audit.recent(10, id),
    };
  }

  /**
   * The status flip, the sign-out of everyone in the store, and the audit
   * entry are one transaction. The conditional UPDATE (status must still be
   * the expected one) makes two admins suspending the same store at once
   * safe: exactly one wins, the other gets a 409 instead of a duplicate log
   * entry.
   */
  async suspend(admin: Admin, id: string, reason: string) {
    const tenant = await this.tenants.findById(id);
    if (!tenant) throw new NotFoundException("Store not found");

    await this.dbRouter.write((db) =>
      db.transaction(async (tx) => {
        const [updated] = await tx
          .update(tenants)
          .set({ status: "suspended", suspendedAt: new Date(), suspensionReason: reason, updatedAt: new Date() })
          .where(and(eq(tenants.id, id), eq(tenants.status, "active")))
          .returning({ id: tenants.id });
        if (!updated) throw new ConflictException("This store is already suspended");

        // Staff and shoppers lose their sessions now, not when their
        // refresh token next comes up. (Access tokens already issued last
        // at most 15 minutes, but every request is refused at the door
        // regardless — see StoreAvailableGuard.)
        await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.tenantId, id), isNull(refreshTokens.revokedAt)));

        await this.audit.record(tx, admin, {
          action: "tenant.suspended",
          targetType: "tenant",
          targetId: id,
          targetLabel: tenant.name,
          tenantId: id,
          metadata: { reason },
        });
      }),
    );
    void publishDashboardUpdate(this.redis);
    return { ok: true, status: "suspended" as const };
  }

  async reactivate(admin: Admin, id: string) {
    const tenant = await this.tenants.findById(id);
    if (!tenant) throw new NotFoundException("Store not found");

    await this.dbRouter.write((db) =>
      db.transaction(async (tx) => {
        const [updated] = await tx
          .update(tenants)
          .set({ status: "active", suspendedAt: null, suspensionReason: null, updatedAt: new Date() })
          .where(and(eq(tenants.id, id), eq(tenants.status, "suspended")))
          .returning({ id: tenants.id });
        if (!updated) throw new ConflictException("This store is not suspended");

        await this.audit.record(tx, admin, {
          action: "tenant.reactivated",
          targetType: "tenant",
          targetId: id,
          targetLabel: tenant.name,
          tenantId: id,
          // The reason it was suspended for lives on in the log: clearing it
          // from the tenant row must not erase why it happened.
          metadata: { previousReason: tenant.suspensionReason },
        });
      }),
    );
    void publishDashboardUpdate(this.redis);
    return { ok: true, status: "active" as const };
  }
}
