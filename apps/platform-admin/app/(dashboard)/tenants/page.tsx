"use client";

import { DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import { useRouter } from "next/navigation";
import { createExportFetcher, createTableFetcher } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import { SubscriptionStatusBadge, TenantStatusBadge, type SUBSCRIPTION_STATUS } from "../../status";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  suspendedAt: string | null;
  createdAt: string;
  planName: string | null;
  subscriptionStatus: keyof typeof SUBSCRIPTION_STATUS | null;
}

const STATUS_FILTER_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

// Read-only list — stores are created by a merchant registering
// (POST /auth/register), not here. Opening one shows its detail page, where
// a platform admin can suspend or reactivate it. No import either: bulk-
// uploading tenants doesn't correspond to anything a real platform admin does.
export default function TenantsPage() {
  useBreadcrumbs([{ label: "Tenants" }]);
  const router = useRouter();
  const fetcher = createTableFetcher<TenantRow>("/platform-admin/tenants");
  const exportFetcher = createExportFetcher("/platform-admin/tenants/export");

  const columns: TableColumn<TenantRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground">{row.slug}</span>
        </span>
      ),
    },
    { key: "plan", header: "Plan", render: (row) => row.planName ?? <span className="text-muted-foreground">—</span> },
    {
      key: "subscription",
      header: "Subscription",
      render: (row) => (row.subscriptionStatus ? <SubscriptionStatusBadge status={row.subscriptionStatus} /> : <span className="text-muted-foreground">—</span>),
    },
    { key: "status", header: "Store", sortable: true, render: (row) => <TenantStatusBadge status={row.status} /> },
    { key: "createdAt", header: "Created", sortable: true, align: "right", render: (row) => formatDate(row.createdAt) },
  ];

  return (
    <>
      <PageHeader title="Tenants" description="Every store on the platform. Open one to see its plan, owners and usage, or to suspend it." />

      <DataTable<TenantRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        exportFetcher={exportFetcher}
        exportFilename="tenants.csv"
        filters={[{ key: "status", label: "All statuses", options: STATUS_FILTER_OPTIONS }]}
        searchPlaceholder="Search name or slug..."
        defaultSortBy="createdAt"
        defaultSortDir="desc"
        onRowClick={(row) => router.push(`/tenants/${row.id}`)}
        emptyMessage="No stores yet."
      />
    </>
  );
}
