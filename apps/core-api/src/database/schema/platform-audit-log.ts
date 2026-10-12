import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Every consequential thing a platform admin does (suspending a store,
 * adding/removing a teammate, changing a password) — who, what, to what,
 * when, and why. Global like `tenants`/`platform_admins`: no RLS, nothing
 * here is tenant-owned data to isolate.
 *
 * Deliberately NO foreign keys: an audit record must outlive what it
 * describes. `adminEmail`/`targetLabel` are snapshots for the same reason —
 * a removed admin or a renamed store must still read correctly in the log.
 * Rows are only ever inserted (PlatformAuditService has no update/delete).
 * `tenantId` is set when the target is a store, so a store's own history
 * is one indexed query.
 */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminId: uuid("admin_id").notNull(),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    targetLabel: text("target_label").notNull(),
    tenantId: uuid("tenant_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("platform_audit_log_created_idx").on(table.createdAt),
    index("platform_audit_log_tenant_idx").on(table.tenantId, table.createdAt),
  ],
);

export type PlatformAuditAction =
  | "tenant.suspended"
  | "tenant.reactivated"
  | "admin.created"
  | "admin.removed"
  | "admin.password_changed";
