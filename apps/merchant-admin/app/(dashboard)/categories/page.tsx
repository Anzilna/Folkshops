"use client";

import { Button, ConfirmDialog, DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, createExportFetcher, createImportFetcher, createTableFetcher } from "../../../lib/api";
import { useTenantSlug } from "../../../lib/hooks";
import type { CategoryRow } from "./category-form";

const ACTIVE_FILTER_OPTIONS = [
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

function ActiveToggle({ row, tenantSlug, onSaved }: { row: CategoryRow; tenantSlug: string | null; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      const res = await apiFetch(`/categories/${row.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !row.isActive }) }, tenantSlug);
      if (res.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      disabled={saving}
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
        row.isActive ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
      }`}
    >
      {row.isActive ? "Active" : "Inactive"}
    </button>
  );
}

export default function CategoriesPage() {
  useBreadcrumbs([{ label: "Categories" }]);
  const router = useRouter();
  const tenantSlug = useTenantSlug();
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<CategoryRow | null>(null);

  const fetcher = createTableFetcher<CategoryRow>("/categories");
  const exportFetcher = createExportFetcher("/categories");
  const importFetcher = createImportFetcher("/categories/import");

  const columns: TableColumn<CategoryRow>[] = [
    {
      key: "name",
      header: "Category",
      sortable: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground">{row.slug}</span>
        </div>
      ),
    },
    { key: "description", header: "Description", render: (row) => <span className="text-muted-foreground">{row.description || "—"}</span> },
    { key: "isActive", header: "Active", render: (row) => <ActiveToggle row={row} tenantSlug={tenantSlug} onSaved={() => setRefreshKey((k) => k + 1)} /> },
    { key: "createdAt", header: "Added", sortable: true, align: "right", render: (row) => <span className="text-muted-foreground">{new Date(row.createdAt).toLocaleDateString("en-IN")}</span> },
  ];

  return (
    <>
      <PageHeader title="Categories" description="How your catalog is organized. Click a row to edit it." />

      <DataTable<CategoryRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        exportFetcher={exportFetcher}
        exportFilename="categories.csv"
        importFetcher={importFetcher}
        filters={[{ key: "isActive", label: "All", options: ACTIVE_FILTER_OPTIONS }]}
        searchPlaceholder="Search categories..."
        defaultSortBy="name"
        onRowClick={(row) => router.push(`/categories/${row.id}`)}
        toolbarActions={
          <Link href="/categories/new">
            <Button variant="primary" size="sm">
              New category
            </Button>
          </Link>
        }
        actions={(row) => (
          <div className="flex justify-end gap-1">
            <Link href={`/categories/${row.id}`}>
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setPendingDelete(row)}>
              Delete
            </Button>
          </div>
        )}
        emptyMessage="No categories yet."
        emptyAction={
          <Link href="/categories/new">
            <Button variant="primary" size="sm">
              Create a category
            </Button>
          </Link>
        }
        refreshKey={refreshKey}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          const res = await apiFetch(`/categories/${pendingDelete.id}`, { method: "DELETE" }, tenantSlug);
          if (res.ok) setRefreshKey((k) => k + 1);
        }}
        title={`Delete "${pendingDelete?.name}"?`}
        description="Products in this category keep existing — they just become uncategorized."
      />
    </>
  );
}
