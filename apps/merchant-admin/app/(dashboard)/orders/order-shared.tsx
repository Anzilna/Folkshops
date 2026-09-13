"use client";

export interface OrderRow {
  id: string;
  customerId: string;
  status: "pending" | "cancelled";
  subtotalCents: number;
  createdAt: string;
}

export function OrderStatusBadge({ status }: { status: OrderRow["status"] }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        status === "pending" ? "bg-accent/10 text-accent" : "bg-destructive/10 text-destructive"
      }`}
    >
      {status}
    </span>
  );
}
