"use client";

import { Button, ConfirmDialog, DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, createExportFetcher, createImportFetcher, createTableFetcher } from "../../../lib/api";
import { useTenantSlug } from "../../../lib/hooks";
import type { CustomerRow } from "./customer-form";

function initials(name: string | null, phone: string): string {
  if (!name) return phone.slice(-2);
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
}

export default function CustomersPage() {
  useBreadcrumbs([{ label: "Customers" }]);
  const router = useRouter();
  const tenantSlug = useTenantSlug();
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<CustomerRow | null>(null);

  const fetcher = createTableFetcher<CustomerRow>("/customers");
  const exportFetcher = createExportFetcher("/customers");
  const importFetcher = createImportFetcher("/customers/import");

  const columns: TableColumn<CustomerRow>[] = [
    {
      key: "name",
      header: "Customer",
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
            {initials(row.name, row.phone)}
          </span>
          <div className="flex flex-col">
            <span className="font-medium">{row.name || <span className="text-muted-foreground">No name</span>}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{row.phone}</span>
          </div>
        </div>
      ),
    },
    { key: "createdAt", header: "Customer since", sortable: true, align: "right", render: (row) => <span className="text-muted-foreground">{new Date(row.createdAt).toLocaleDateString("en-IN")}</span> },
  ];

  return (
    <>
      <PageHeader title="Customers" description="Everyone with an account at your store. Click a row to edit." />

      <DataTable<CustomerRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        exportFetcher={exportFetcher}
        exportFilename="customers.csv"
        importFetcher={importFetcher}
        searchPlaceholder="Search phone or name..."
        defaultSortBy="createdAt"
        defaultSortDir="desc"
        onRowClick={(row) => router.push(`/customers/${row.id}`)}
        toolbarActions={
          <Link href="/customers/new">
            <Button variant="primary" size="sm">
              New customer
            </Button>
          </Link>
        }
        actions={(row) => (
          <div className="flex justify-end gap-1">
            <Link href={`/customers/${row.id}`}>
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setPendingDelete(row)}>
              Delete
            </Button>
          </div>
        )}
        emptyMessage="No customers yet — they appear here after their first OTP login, or you can add them."
        refreshKey={refreshKey}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          const res = await apiFetch(`/customers/${pendingDelete.id}`, { method: "DELETE" }, tenantSlug);
          if (res.ok) setRefreshKey((k) => k + 1);
        }}
        title={`Delete ${pendingDelete?.name || pendingDelete?.phone}?`}
        description="This removes the customer record. Their past orders are kept."
      />
    </>
  );
}
