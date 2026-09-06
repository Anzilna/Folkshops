import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, Db } from "../database/database.module";
import { tenants } from "../database/schema";

@Injectable()
export class TenantsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findBySlug(slug: string) {
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return tenant ?? null;
  }
}
