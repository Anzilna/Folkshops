import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { platformAdmins } from "../database/schema";

@Injectable()
export class PlatformAdminsService {
  constructor(private readonly dbRouter: DbRouter) {}

  /** Auth-path lookup (login credential check) — always strong. */
  async findByEmail(email: string) {
    return this.dbRouter.read("strong", async (db) => {
      const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email)).limit(1);
      return admin ?? null;
    });
  }

  /** Auth-path lookup (refresh token exchange) — always strong. */
  async findById(id: string) {
    return this.dbRouter.read("strong", async (db) => {
      const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, id)).limit(1);
      return admin ?? null;
    });
  }
}
