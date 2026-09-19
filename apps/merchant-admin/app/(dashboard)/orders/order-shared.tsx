"use client";

// Matches orderStatusEnum (database/schema/orders.ts) exactly — this type
// had drifted to just "pending" | "cancelled" (pre-dating the payment
// state machine), which silently painted every payment-related status —
// including "paid" — with the same red destructive color as a genuine
// failure. Caught live: a real order showed "Paid" in red.
export interface OrderRow {
  id: string;
  customerId: string;
  status: "pending" | "awaiting_payment" | "paid" | "payment_failed" | "cancelled" | "refunded" | "partially_refunded";
  subtotalCents: number;
  createdAt: string;
}

const STATUS_STYLES: Record<OrderRow["status"], string> = {
  pending: "bg-accent/10 text-accent",
  awaiting_payment: "bg-accent/10 text-accent",
  paid: "bg-success/10 text-success",
  payment_failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  refunded: "bg-muted text-muted-foreground",
  partially_refunded: "bg-muted text-muted-foreground",
};

export function OrderStatusBadge({ status }: { status: OrderRow["status"] }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
