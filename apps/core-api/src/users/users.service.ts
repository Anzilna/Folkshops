import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { users } from "../database/schema";

@Injectable()
export class UsersService {
  constructor(private readonly dbRouter: DbRouter) {}

  /** Auth-path lookup (login credential check, register uniqueness check) — always strong. */
  async findByEmail(email: string) {
    return this.dbRouter.read("strong", async (db) => {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return user ?? null;
    });
  }

  /** Auth-path lookup (refresh token exchange) — always strong. */
  async findById(id: string) {
    return this.dbRouter.read("strong", async (db) => {
      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return user ?? null;
    });
  }
}
