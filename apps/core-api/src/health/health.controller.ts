import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbRouter } from "../database/db-router";

@Controller("health")
export class HealthController {
  constructor(private readonly dbRouter: DbRouter) {}

  @Get()
  async check() {
    try {
      await this.dbRouter.read("strong", (db) => db.execute(sql`SELECT 1`));
      return { status: "ok", db: "connected" };
    } catch {
      throw new ServiceUnavailableException({ status: "error", db: "unreachable" });
    }
  }
}
