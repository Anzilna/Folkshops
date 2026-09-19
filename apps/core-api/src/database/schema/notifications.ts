import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/** Mirrors @folkshops/ui's own `NotificationKind` (packages/ui/src/notifications.tsx)
 * exactly — that component's icon/color mapping is keyed on these four
 * values, so a fifth kind added here without a matching UI case would
 * silently render with no icon. */
export const notificationKindEnum = pgEnum("notification_kind", ["order", "stock", "customer", "system"]);

/**
 * Tenant-owned, RLS-enabled — what merchant-admin's notification bell
 * actually reads now, replacing @folkshops/ui's `demoNotifications()`
 * canned data. Written only by `apps/workers`' job handlers (via
 * `withTenantContext`), never directly by `core-api` request handlers —
 * everything that creates a notification goes through the outbox first
 * (see outbox-events.ts), so a crash between "the real thing happened"
 * and "a notification was created for it" can't lose the notification.
 */
export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  kind: notificationKindEnum("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
