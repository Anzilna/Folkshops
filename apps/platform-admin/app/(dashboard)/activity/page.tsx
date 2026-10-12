"use client";

import { DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import Link from "next/link";
import { createTableFetcher } from "../../../lib/api";
import { AUDIT_ACTION_LABELS, AUDIT_FILTER_OPTIONS, auditDetail } from "../../../lib/audit";
import { formatDateTime } from "../../../lib/format";
import type { AuditRow } from "../../../lib/platform-api";

// The audit log: every consequential admin action, newest first. Append-only
// on the server — there is nothing to edit, delete or import here.
export default function ActivityPage() {
  useBreadcrumbs([{ label: "Activity" }]);
  const fetcher = createTableFetcher<AuditRow>("/platform-admin/audit-log");

  const columns: TableColumn<AuditRow>[] = [
    { key: "createdAt", header: "When", sortable: true, render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.createdAt)}</span> },
    { key: "action", header: "Action", sortable: true, render: (row) => <span className="whitespace-nowrap font-medium">{AUDIT_ACTION_LABELS[row.action] ?? row.action}</span> },
    { key: "adminEmail", header: "Admin", sortable: true, render: (row) => <span className="whitespace-nowrap">{row.adminEmail}</span> },
    {
      key: "target",
      header: "Target",
      render: (row) =>
        row.tenantId ? (
          <Link href={`/tenants/${row.tenantId}`} className="underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.targetLabel}
          </Link>
        ) : (
          row.targetLabel
        ),
    },
    { key: "details", header: "Details", render: (row) => <span className="text-muted-foreground">{auditDetail(row) || "—"}</span> },
  ];

  return (
    <>
      <PageHeader title="Activity" description="A permanent record of what platform admins have done — who, what, and why." />
      <DataTable<AuditRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        filters={[{ key: "action", label: "All actions", options: AUDIT_FILTER_OPTIONS }]}
        searchPlaceholder="Search admin or target..."
        defaultSortBy="createdAt"
        defaultSortDir="desc"
        emptyMessage="Nothing recorded yet."
      />
    </>
  );
}
