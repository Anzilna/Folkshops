import { Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { plans } from "../database/schema";

/** plans is not tenant-owned (no RLS, see plans.ts's own comment) — plain reads, no withTenantContext needed. */
@Injectable()
export class PlansService {
  constructor(private readonly dbRouter: DbRouter) {}

  async listActive() {
    return this.dbRouter.read("eventual", (db) =>
      db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.priceCents)),
    );
  }

  async findBySlug(slug: string) {
    const [plan] = await this.dbRouter.read("strong", (db) =>
      db.select().from(plans).where(eq(plans.slug, slug)).limit(1),
    );
    return plan ?? null;
  }
}
