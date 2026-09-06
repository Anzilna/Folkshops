import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DRIZZLE, Db } from "../database/database.module";

@Controller("health")
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  @Get()
  async check() {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { status: "ok", db: "connected" };
    } catch {
      throw new ServiceUnavailableException({ status: "error", db: "unreachable" });
    }
  }
}
