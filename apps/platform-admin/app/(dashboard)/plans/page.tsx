"use client";

import { DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import { createTableFetcher } from "../../../lib/api";
import { formatPrice } from "../../../lib/format";
import { StatusBadge } from "../../status";

interface PlanRow {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  currency: string;
  maxProducts: number | null;
  aiAccess: boolean;
  isActive: boolean;
  billable: boolean;
  activeSubscribers: number;
  totalSubscriptions: number;
}

// Read-only on purpose: a plan's price is tied to an immutable Stripe Price,
// so changing one is a billing operation (scripts/bootstrap-stripe-plans.ts),
// not an edit form.
export default function PlansPage() {
  useBreadcrumbs([{ label: "Plans" }]);
  const fetcher = createTableFetcher<PlanRow>("/platform-admin/plans");

  const columns: TableColumn<PlanRow>[] = [
    {
      key: "name",
      header: "Plan",
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground">{row.slug}</span>
        </span>
      ),
    },
    { key: "price", header: "Price", render: (row) => (row.priceCents === 0 ? "Free" : `${formatPrice(row.priceCents)} / month`) },
    { key: "products", header: "Products", render: (row) => row.maxProducts ?? "Unlimited" },
    { key: "ai", header: "AI assistant", render: (row) => (row.aiAccess ? "Included" : "—") },
    {
      key: "availability",
      header: "Availability",
      render: (row) =>
        !row.isActive ? (
          <StatusBadge tone="neutral">Hidden</StatusBadge>
        ) : !row.billable ? (
          <StatusBadge tone="warning">No Stripe price</StatusBadge>
        ) : (
          <StatusBadge tone="good">Offered</StatusBadge>
        ),
    },
    { key: "active", header: "Paying stores", align: "right", render: (row) => <span className="tabular-nums">{row.activeSubscribers}</span> },
    { key: "total", header: "All stores", align: "right", render: (row) => <span className="tabular-nums">{row.totalSubscriptions}</span> },
  ];

  return (
    <>
      <PageHeader title="Plans" description="What merchants can subscribe to, and how many stores are on each. Prices are managed in Stripe." />
      <DataTable<PlanRow> columns={columns} getRowId={(row) => row.id} fetcher={fetcher} emptyMessage="No plans." />
    </>
  );
}
