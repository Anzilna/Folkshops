import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { notifications } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";

/**
 * Read/mark-read only — nothing here ever inserts a notification.
 * Notifications are only ever created by apps/workers' `order.paid` job
 * handler (via the outbox), never directly by a request handler; see
 * notifications.ts's own schema comment for why.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly dbRouter: DbRouter) {}

  /** "eventual" is fine here — the bell doesn't need read-your-own-write
   * freshness the way a payment-status check does, and this runs on every
   * dashboard page load (AdminShell), so offloading it to the replica
   * matches ProductsService.list()'s own reasoning. */
  async list(tenantId: string) {
    return this.dbRouter.read("eventual", (db) =>
      withTenantContext(db, tenantId, (tx) =>
        tx.select().from(notifications).where(eq(notifications.tenantId, tenantId)).orderBy(desc(notifications.createdAt)).limit(50),
      ),
    );
  }

  async markRead(tenantId: string, id: string) {
    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(eq(notifications.id, id), eq(notifications.tenantId, tenantId)))
          .returning();
        return row ?? null;
      }),
    );
  }

  async markAllRead(tenantId: string) {
    await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, (tx) =>
        tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.tenantId, tenantId), isNull(notifications.readAt))),
      ),
    );
  }
}
