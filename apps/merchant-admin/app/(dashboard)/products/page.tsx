"use client";

import { Button, DataTable, type TableColumn } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch, createExportFetcher, createImportFetcher, createTableFetcher, getStoredTenantSlug } from "../../../lib/api";
import { ProductForm, type ProductRow } from "./product-form";

const STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

function formatPrice(cents: number): string {
  return `₹${(cents / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default function ProductsPage() {
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setTenantSlug(getStoredTenantSlug(document.cookie));
  }, []);

  const fetcher = createTableFetcher<ProductRow>("/products");
  const exportFetcher = createExportFetcher("/products");
  const importFetcher = createImportFetcher("/products/import");

  async function handleDelete(row: ProductRow) {
    if (!confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    const res = await apiFetch(`/products/${row.id}`, { method: "DELETE" }, tenantSlug);
    if (res.ok) setRefreshKey((k) => k + 1);
    else alert("Delete failed");
  }

  const columns: TableColumn<ProductRow>[] = [
    { key: "name", header: "Name", sortable: true },
    { key: "slug", header: "Slug" },
    { key: "priceCents", header: "Price", sortable: true, render: (row) => formatPrice(row.priceCents) },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            row.status === "active"
              ? "bg-success/15 text-success"
              : row.status === "archived"
                ? "bg-muted text-muted-foreground"
                : "bg-accent/10 text-accent"
          }`}
        >
          {row.status}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground">Manage your catalog.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          New product
        </Button>
      </div>

      <DataTable<ProductRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        exportFetcher={exportFetcher}
        exportFilename="products.csv"
        importFetcher={importFetcher}
        filters={[{ key: "status", label: "All statuses", options: STATUS_FILTER_OPTIONS }]}
        searchPlaceholder="Search products..."
        defaultSortBy="createdAt"
        defaultSortDir="desc"
        emptyMessage="No products yet — add your first one."
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

      <ProductForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
        product={editing}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
