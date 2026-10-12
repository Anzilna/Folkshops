import { ForbiddenException, Injectable } from "@nestjs/common";
import { and, count, eq, isNull } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { plans, products, subscriptions } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";

/**
 * The only limit actually enforced today — see docs/decisions/0012's
 * "What's enforced vs. tracked-only" section for why staff-seat and
 * AI-access limits are stored on `plans` but not checked anywhere yet (no
 * real caller exists for either).
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly dbRouter: DbRouter) {}

  async assertProductLimitNotExceeded(tenantId: string): Promise<void> {
    const maxProducts = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .select({ maxProducts: plans.maxProducts })
          .from(subscriptions)
          .innerJoin(plans, eq(subscriptions.planId, plans.id))
          .where(eq(subscriptions.tenantId, tenantId))
          .limit(1);
        return row?.maxProducts ?? null;
      }),
    );
    // null = unlimited plan, or no subscription row at all (shouldn't
    // happen post-registration, but failing open rather than blocking
    // every product creation on a missing row we can't explain here).
    if (maxProducts === null) return;

    const currentCount = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .select({ value: count() })
          .from(products)
          .where(and(eq(products.tenantId, tenantId), isNull(products.deletedAt)));
        return row?.value ?? 0;
      }),
    );

    if (currentCount >= maxProducts) {
      throw new ForbiddenException(
        `Your plan allows up to ${maxProducts} products. Upgrade your plan to add more.`,
      );
    }
  }
}
