"use client";

import { Button, ConfirmDialog, DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, createExportFetcher, createImportFetcher, createTableFetcher } from "../../../lib/api";
import { formatPrice } from "../../../lib/format";
import { useTenantSlug } from "../../../lib/hooks";
import type { ProductRow } from "./product-form";

const STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const ACTIVE_FILTER_OPTIONS = [
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

function StatusBadge({ status }: { status: ProductRow["status"] }) {
  const cls =
    status === "active"
      ? "bg-success/15 text-success"
      : status === "archived"
        ? "bg-muted text-muted-foreground"
        : "bg-accent/10 text-accent";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>{status}</span>;
}

/** isActive is a staff-only on/off switch, separate from the storefront
 * publish `status` above (see products.ts schema comment) — click to
 * toggle without opening the full edit form. */
function ActiveToggle({ row, tenantSlug, onSaved }: { row: ProductRow; tenantSlug: string | null; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      const res = await apiFetch(`/products/${row.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !row.isActive }) }, tenantSlug);
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

export default function ProductsPage() {
  useBreadcrumbs([{ label: "Products" }]);
  const router = useRouter();
  const tenantSlug = useTenantSlug();
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<ProductRow | null>(null);
  const [pendingBulk, setPendingBulk] = useState<{ ids: string[]; clear: () => void } | null>(null);

  const fetcher = createTableFetcher<ProductRow>("/products");
  const exportFetcher = createExportFetcher("/products");
  const importFetcher = createImportFetcher("/products/import");

  async function deleteMany(ids: string[]) {
    await Promise.all(ids.map((id) => apiFetch(`/products/${id}`, { method: "DELETE" }, tenantSlug)));
    setRefreshKey((k) => k + 1);
  }

  const columns: TableColumn<ProductRow>[] = [
    {
      key: "name",
      header: "Product",
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-3">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external S3/MinIO URL
            <img src={row.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
              {row.name.charAt(0)}
            </span>
          )}
          <div className="flex flex-col">
            <span className="font-medium">{row.name}</span>
            <span className="text-xs text-muted-foreground">{row.slug}</span>
          </div>
        </div>
      ),
    },
    { key: "status", header: "Status", sortable: true, render: (row) => <StatusBadge status={row.status} /> },
    { key: "isActive", header: "Active", render: (row) => <ActiveToggle row={row} tenantSlug={tenantSlug} onSaved={() => setRefreshKey((k) => k + 1)} /> },
    { key: "priceCents", header: "Price", sortable: true, align: "right", render: (row) => <span className="tabular-nums">{formatPrice(row.priceCents)}</span> },
    { key: "createdAt", header: "Added", sortable: true, align: "right", render: (row) => <span className="text-muted-foreground">{new Date(row.createdAt).toLocaleDateString("en-IN")}</span> },
  ];

  return (
    <>
      <PageHeader title="Products" description="Everything in your catalog. Click a row to edit it." />

      <DataTable<ProductRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        exportFetcher={exportFetcher}
        exportFilename="products.csv"
        importFetcher={importFetcher}
        filters={[
          { key: "status", label: "All statuses", options: STATUS_FILTER_OPTIONS },
          { key: "isActive", label: "All", options: ACTIVE_FILTER_OPTIONS },
        ]}
        searchPlaceholder="Search products..."
        defaultSortBy="createdAt"
        defaultSortDir="desc"
        selectable
        onRowClick={(row) => router.push(`/products/${row.id}`)}
        toolbarActions={
          <Link href="/products/new">
            <Button variant="primary" size="sm">
              New product
            </Button>
          </Link>
        }
        bulkActions={(ids, clear) => (
          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setPendingBulk({ ids, clear })}>
            Delete selected
          </Button>
        )}
        actions={(row) => (
          <div className="flex justify-end gap-1">
            <Link href={`/products/${row.id}`}>
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setPendingDelete(row)}>
              Delete
            </Button>
          </div>
        )}
        emptyMessage="No products yet."
        emptyAction={
          <Link href="/products/new">
            <Button variant="primary" size="sm">
              Add your first product
            </Button>
          </Link>
        }
        refreshKey={refreshKey}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => deleteMany(pendingDelete ? [pendingDelete.id] : [])}
        title={`Delete "${pendingDelete?.name}"?`}
        description="Removes it from your catalog and every listing. Orders that already include it keep their own snapshot."
      />
      <ConfirmDialog
        open={!!pendingBulk}
        onClose={() => setPendingBulk(null)}
        onConfirm={async () => {
          if (!pendingBulk) return;
          await deleteMany(pendingBulk.ids);
          pendingBulk.clear();
        }}
        title={`Delete ${pendingBulk?.ids.length} products?`}
        description="Removes them from your catalog and every listing."
        confirmLabel="Delete all"
      />
    </>
  );
}
