"use client";

import { DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import { createExportFetcher, createTableFetcher } from "../../../lib/api";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  createdAt: string;
}

const STATUS_FILTER_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

// Read-only — tenants are provisioned by a merchant registering
// (POST /auth/register), not created here. No import either, same
// reasoning as OrdersController: bulk-uploading tenants doesn't
// correspond to anything a real platform admin does.
export default function TenantsPage() {
  useBreadcrumbs([{ label: "Tenants" }]);
  const fetcher = createTableFetcher<TenantRow>("/platform-admin/tenants");
  const exportFetcher = createExportFetcher("/platform-admin/tenants/export");

  const columns: TableColumn<TenantRow>[] = [
    { key: "name", header: "Name", sortable: true },
    { key: "slug", header: "Slug", sortable: true },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            row.status === "active" ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"
          }`}
        >
          {row.status}
        </span>
      ),
    },
    { key: "createdAt", header: "Created", sortable: true, align: "right", render: (row) => new Date(row.createdAt).toLocaleDateString() },
  ];

  return (
    <>
      <PageHeader title="Tenants" description="Every store on the platform. Stores are created by merchant self-registration." />

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
        emptyMessage="No stores yet."
      />
    </>
  );
}
