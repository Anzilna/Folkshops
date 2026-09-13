"use client";

import { Button, DataTable, type TableColumn } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch, createExportFetcher, createImportFetcher, createTableFetcher, getStoredTenantSlug } from "../../../lib/api";
import { CustomerForm, type CustomerRow } from "./customer-form";

export default function CustomersPage() {
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setTenantSlug(getStoredTenantSlug(document.cookie));
  }, []);

  const fetcher = createTableFetcher<CustomerRow>("/customers");
  const exportFetcher = createExportFetcher("/customers");
  const importFetcher = createImportFetcher("/customers/import");

  async function handleDelete(row: CustomerRow) {
    if (!confirm(`Delete customer "${row.phone}"? This can't be undone.`)) return;
    const res = await apiFetch(`/customers/${row.id}`, { method: "DELETE" }, tenantSlug);
    if (res.ok) setRefreshKey((k) => k + 1);
    else alert("Delete failed");
  }

  const columns: TableColumn<CustomerRow>[] = [
    { key: "phone", header: "Phone", sortable: true },
    { key: "name", header: "Name", sortable: true, render: (row) => row.name || "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground">Everyone who has an account at your store.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          New customer
        </Button>
      </div>

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
        emptyMessage="No customers yet."
        refreshKey={refreshKey}
        actions={(row) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(row);
                setFormOpen(true);
              }}
            >
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(row)} className="text-destructive hover:bg-destructive/10">
              Delete
            </Button>
          </div>
        )}
      />

      <CustomerForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
        customer={editing}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
