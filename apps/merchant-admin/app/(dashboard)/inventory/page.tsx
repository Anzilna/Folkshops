"use client";

import { Button, ConfirmDialog, DataTable, Input, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, createExportFetcher, createImportFetcher, createTableFetcher, getStoredTenantSlug } from "../../../lib/api";

export interface InventoryRow {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  isActive: boolean;
  updatedAt: string;
}

const ACTIVE_FILTER_OPTIONS = [
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

/** Click-to-edit quantity — kept inline rather than a full form since it's
 * the one field someone adjusts constantly. */
function QuantityCell({
  row,
  tenantSlug,
  onSaved,
}: {
  row: InventoryRow;
  tenantSlug: string | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.quantity));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch(
        `/inventory/${row.productId}`,
        { method: "PATCH", body: JSON.stringify({ quantity: Number(value) }) },
        tenantSlug,
      );
      if (!res.ok) throw new Error("Save failed");
      setEditing(false);
      onSaved();
    } catch {
      setValue(String(row.quantity));
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className={`rounded-md px-2 py-0.5 text-sm hover:bg-muted ${row.quantity === 0 ? "text-destructive" : "text-foreground"}`}
      >
        {row.quantity}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        type="number"
        min="0"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-20"
      />
      <Button size="sm" variant="primary" onClick={save} disabled={saving}>
        {saving ? "..." : "Save"}
      </Button>
    </span>
  );
}

/** isActive is a staff-only pause switch, distinct from quantity=0 (see
 * inventory.ts schema comment) — click to toggle. */
function ActiveToggle({ row, tenantSlug, onSaved }: { row: InventoryRow; tenantSlug: string | null; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      const res = await apiFetch(`/inventory/${row.productId}`, { method: "PATCH", body: JSON.stringify({ isActive: !row.isActive }) }, tenantSlug);
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

export default function InventoryPage() {
  useBreadcrumbs([{ label: "Inventory" }]);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<InventoryRow | null>(null);

  useEffect(() => {
    setTenantSlug(getStoredTenantSlug(document.cookie));
  }, []);

  const fetcher = createTableFetcher<InventoryRow>("/inventory");
  const exportFetcher = createExportFetcher("/inventory");
  const importFetcher = createImportFetcher("/inventory/import");

  const columns: TableColumn<InventoryRow>[] = [
    { key: "productName", header: "Product", sortable: true },
    {
      key: "quantity",
      header: "In stock",
      sortable: true,
      align: "right",
      render: (row) => <span className="inline-flex justify-end"><QuantityCell row={row} tenantSlug={tenantSlug} onSaved={() => setRefreshKey((k) => k + 1)} /></span>,
    },
    { key: "isActive", header: "Active", render: (row) => <ActiveToggle row={row} tenantSlug={tenantSlug} onSaved={() => setRefreshKey((k) => k + 1)} /> },
    { key: "updatedAt", header: "Updated", sortable: true, align: "right", render: (row) => new Date(row.updatedAt).toLocaleDateString() },
  ];

  return (
    <>
      <PageHeader title="Inventory" description="Stock per product — click a quantity to change it, or add a record for a product that doesn't have one yet." />

      <DataTable<InventoryRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        exportFetcher={exportFetcher}
        exportFilename="inventory.csv"
        importFetcher={importFetcher}
        filters={[{ key: "isActive", label: "All", options: ACTIVE_FILTER_OPTIONS }]}
        searchPlaceholder="Search products..."
        defaultSortBy="updatedAt"
        defaultSortDir="desc"
        toolbarActions={
          <Link href="/inventory/new">
            <Button variant="primary" size="sm">
              New inventory record
            </Button>
          </Link>
        }
        actions={(row) => (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setPendingDelete(row)}>
              Delete
            </Button>
          </div>
        )}
        emptyMessage="No stock set for any product yet — import a CSV or add a record."
        emptyAction={
          <Link href="/inventory/new">
            <Button variant="primary" size="sm">
              Add a record
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
          const res = await apiFetch(`/inventory/${pendingDelete.productId}`, { method: "DELETE" }, tenantSlug);
          if (res.ok) setRefreshKey((k) => k + 1);
        }}
        title={`Delete inventory record for "${pendingDelete?.productName}"?`}
        description="Stops tracking stock for this product. Add a new record any time to pick it back up."
      />
    </>
  );
}
