"use client";

import { Button, Card, PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useParams, useRouter } from "next/navigation";
import { useResource } from "../../../../lib/hooks";
import { formatPrice } from "../../../../lib/format";
import { OrderStatusBadge, type OrderRow } from "../order-shared";

interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  priceCents: number;
  quantity: number;
}

interface OrderDetail extends OrderRow {
  items: OrderItem[];
}

// Read-only — orders have no edit form. They only ever come from a
// customer's own checkout (see core-api's OrdersService comment), and the
// line items are the snapshot taken at that moment, not live products.
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: order, loading, error } = useResource<OrderDetail>(`/orders/${id}`);
  const short = `#${id.slice(0, 8).toUpperCase()}`;

  useBreadcrumbs([{ label: "Orders", href: "/orders" }, { label: short }]);

  if (error) {
    return (
      <Card className="text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/orders")}>
          Back to orders
        </Button>
      </Card>
    );
  }

  if (loading || !order) {
    return (
      <>
        <PageHeader title={short} />
        <Card className="h-64 animate-pulse bg-muted/40" />
      </>
    );
  }

  const units = order.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <>
      <PageHeader
        title={`Order ${short}`}
        description={`Placed ${new Date(order.createdAt).toLocaleString("en-AE", { dateStyle: "long", timeStyle: "short" })}`}
        actions={<OrderStatusBadge status={order.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card className="p-0">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-medium">
              Items <span className="text-muted-foreground">({units} unit{units === 1 ? "" : "s"})</span>
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 px-6 py-3.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.productName}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatPrice(item.priceCents)} &times; {item.quantity}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">{formatPrice(item.priceCents * item.quantity)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3 text-sm">
            <h2 className="text-sm font-medium">Summary</h2>
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums text-foreground">{formatPrice(order.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping</span>
              <span>&mdash;</span>
            </div>
            <div className="flex justify-between border-t border-border pt-3 font-medium">
              <span>Total</span>
              <span className="tabular-nums">{formatPrice(order.subtotalCents)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Payment and fulfillment tracking arrive in Phase 2.</p>
          </Card>

          <Card className="flex flex-col gap-2 text-sm">
            <h2 className="text-sm font-medium">Customer</h2>
            <Button variant="outline" size="sm" onClick={() => router.push(`/customers/${order.customerId}`)}>
              View customer
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}
