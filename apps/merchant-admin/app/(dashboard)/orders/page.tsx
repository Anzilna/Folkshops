"use client";

import { Button, DataTable, type TableColumn } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { createExportFetcher, createTableFetcher, getStoredTenantSlug } from "../../../lib/api";
import { OrderDetailModal } from "./order-detail";

interface OrderRow {
  id: string;
  status: "pending" | "cancelled";
  subtotalCents: number;
  createdAt: string;
}

const STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
];

function formatPrice(cents: number): string {
  return `₹${(cents / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default function OrdersPage() {
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  useEffect(() => {
    setTenantSlug(getStoredTenantSlug(document.cookie));
  }, []);

  const fetcher = createTableFetcher<OrderRow>("/orders");
  const exportFetcher = createExportFetcher("/orders");

  const columns: TableColumn<OrderRow>[] = [
    { key: "id", header: "Order", render: (row) => row.id.slice(0, 8) },
    { key: "subtotalCents", header: "Total", sortable: true, render: (row) => formatPrice(row.subtotalCents) },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            row.status === "pending" ? "bg-accent/10 text-accent" : "bg-destructive/10 text-destructive"
          }`}
        >
          {row.status}
        </span>
      ),
    },
    { key: "createdAt", header: "Placed", sortable: true, render: (row) => new Date(row.createdAt).toLocaleDateString() },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Orders come from a customer&apos;s own checkout — nothing to create here.
        </p>
      </div>

      <DataTable<OrderRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        exportFetcher={exportFetcher}
        exportFilename="orders.csv"
        filters={[{ key: "status", label: "All statuses", options: STATUS_FILTER_OPTIONS }]}
        searchPlaceholder="Search by customer phone..."
        defaultSortBy="createdAt"
        defaultSortDir="desc"
        emptyMessage="No orders yet."
        actions={(row) => (
          <Button variant="ghost" size="sm" onClick={() => setViewingId(row.id)}>
            View
          </Button>
        )}
      />

      <OrderDetailModal orderId={viewingId} onClose={() => setViewingId(null)} tenantSlug={tenantSlug} />
    </div>
  );
}
