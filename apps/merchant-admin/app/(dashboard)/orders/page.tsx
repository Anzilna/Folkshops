"use client";

import { DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import { useRouter } from "next/navigation";
import { createExportFetcher, createTableFetcher } from "../../../lib/api";
import { formatDateTime, formatPrice } from "../../../lib/format";
import { OrderStatusBadge, type OrderRow } from "./order-shared";

const STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
];

export default function OrdersPage() {
  useBreadcrumbs([{ label: "Orders" }]);
  const router = useRouter();

  const fetcher = createTableFetcher<OrderRow>("/orders");
  const exportFetcher = createExportFetcher("/orders");

  const columns: TableColumn<OrderRow>[] = [
    { key: "id", header: "Order", render: (row) => <span className="font-mono text-xs font-medium uppercase">#{row.id.slice(0, 8)}</span> },
    { key: "status", header: "Status", sortable: true, render: (row) => <OrderStatusBadge status={row.status} /> },
    { key: "subtotalCents", header: "Total", sortable: true, align: "right", render: (row) => <span className="font-medium tabular-nums">{formatPrice(row.subtotalCents)}</span> },
    {
      key: "createdAt",
      header: "Placed",
      sortable: true,
      align: "right",
      render: (row) => <span className="text-muted-foreground">{formatDateTime(row.createdAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader title="Orders" description="Orders come from a customer's own checkout — click one to see its line items." />

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
        onRowClick={(row) => router.push(`/orders/${row.id}`)}
        emptyMessage="No orders yet."
      />
    </>
  );
}
