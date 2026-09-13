"use client";

import { Button, DataTable, Input, type TableColumn } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch, createExportFetcher, createImportFetcher, createTableFetcher, getStoredTenantSlug } from "../../../lib/api";

interface InventoryRow {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  updatedAt: string;
}

/** Inline quantity editing — inventory has no create/delete (a row appears
 * the first time a quantity is set for a product), so a full modal form
 * would be more ceremony than the single editable field needs. */
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
        onClick={() => setEditing(true)}
        className={`rounded-md px-2 py-0.5 text-sm hover:bg-muted ${row.quantity === 0 ? "text-destructive" : "text-foreground"}`}
      >
        {row.quantity}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
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

export default function InventoryPage() {
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
      render: (row) => <QuantityCell row={row} tenantSlug={tenantSlug} onSaved={() => setRefreshKey((k) => k + 1)} />,
    },
    { key: "updatedAt", header: "Updated", sortable: true, render: (row) => new Date(row.updatedAt).toLocaleDateString() },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Stock levels per product. A product appears here once a quantity has been set for it.
        </p>
      </div>

      <DataTable<InventoryRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        exportFetcher={exportFetcher}
        exportFilename="inventory.csv"
        importFetcher={importFetcher}
        searchPlaceholder="Search products..."
        defaultSortBy="updatedAt"
        defaultSortDir="desc"
        emptyMessage="No stock set for any product yet — import a CSV or set a quantity from a product."
        refreshKey={refreshKey}
      />
    </div>
  );
}
