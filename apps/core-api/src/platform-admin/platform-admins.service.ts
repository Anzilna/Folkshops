import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { platformAdmins } from "../database/schema";

/** Lookups and the one write the login path needs. Managing teammates (create/remove/password) lives in PlatformAdminTeamService. */
@Injectable()
export class PlatformAdminsService {
  constructor(private readonly dbRouter: DbRouter) {}

  /**
   * Auth-path lookup (login credential check) — always strong. Case-
   * insensitive, so "Admin@Folkshops.com" finds the account whichever way
   * it was typed when it was created.
   */
  async findByEmail(email: string) {
    return this.dbRouter.read("strong", async (db) => {
      const [admin] = await db
        .select()
        .from(platformAdmins)
        .where(sql`lower(${platformAdmins.email}) = ${email.trim().toLowerCase()}`)
        .limit(1);
      return admin ?? null;
    });
  }

  /** Auth-path lookup (refresh token exchange, and the access guard on every request) — always strong. */
  async findById(id: string) {
    return this.dbRouter.read("strong", async (db) => {
      const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, id)).limit(1);
      return admin ?? null;
    });
  }

  async recordLogin(id: string): Promise<void> {
    await this.dbRouter.write((db) => db.update(platformAdmins).set({ lastLoginAt: new Date() }).where(eq(platformAdmins.id, id)));
  }
}
