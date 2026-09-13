"use client";

import { DataTable, type TableColumn } from "@folkshops/ui";
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
    { key: "createdAt", header: "Created", sortable: true, render: (row) => new Date(row.createdAt).toLocaleDateString() },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">Tenants</h1>
        <p className="text-sm text-muted-foreground">Every store on the platform. Stores are created by merchant self-registration.</p>
      </div>

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
    </div>
  );
}
