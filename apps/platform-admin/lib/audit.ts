import type { AuditRow } from "./platform-api";

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "tenant.suspended": "Store suspended",
  "tenant.reactivated": "Store reactivated",
  "admin.created": "Team member added",
  "admin.removed": "Team member removed",
  "admin.password_changed": "Password changed",
};

export const AUDIT_FILTER_OPTIONS = Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label }));

/** The one-line detail for an audit row — the reason a store was suspended, etc. */
export function auditDetail(row: AuditRow): string {
  const reason = row.metadata.reason ?? row.metadata.previousReason;
  if (typeof reason === "string" && reason) return row.action === "tenant.reactivated" ? `Was suspended for: ${reason}` : reason;
  return "";
}
