import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { tenants } from "../database/schema";

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
}
