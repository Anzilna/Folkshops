"use client";

import { Button, DataTable, type TableColumn } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch, createExportFetcher, createImportFetcher, createTableFetcher, getStoredTenantSlug } from "../../../lib/api";
import { CategoryForm, type CategoryRow } from "./category-form";

export default function CategoriesPage() {
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setTenantSlug(getStoredTenantSlug(document.cookie));
  }, []);

  const fetcher = createTableFetcher<CategoryRow>("/categories");
  const exportFetcher = createExportFetcher("/categories");
  const importFetcher = createImportFetcher("/categories/import");

  async function handleDelete(row: CategoryRow) {
    if (!confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    const res = await apiFetch(`/categories/${row.id}`, { method: "DELETE" }, tenantSlug);
    if (res.ok) setRefreshKey((k) => k + 1);
    else alert("Delete failed");
  }

  const columns: TableColumn<CategoryRow>[] = [
    { key: "name", header: "Name", sortable: true },
    { key: "slug", header: "Slug" },
    { key: "description", header: "Description", render: (row) => row.description || "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground">Categories</h1>
          <p className="text-sm text-muted-foreground">Organize your catalog.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          New category
        </Button>
      </div>

      <DataTable<CategoryRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        exportFetcher={exportFetcher}
        exportFilename="categories.csv"
        importFetcher={importFetcher}
        searchPlaceholder="Search categories..."
        defaultSortBy="createdAt"
        defaultSortDir="desc"
        emptyMessage="No categories yet."
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

      <CategoryForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
        category={editing}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
