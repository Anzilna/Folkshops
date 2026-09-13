"use client";

import { Modal } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

interface OrderItem {
  id: string;
  productName: string;
  priceCents: number;
  quantity: number;
}

interface OrderDetail {
  id: string;
  status: string;
  subtotalCents: number;
  createdAt: string;
  items: OrderItem[];
}

function formatPrice(cents: number): string {
  return `₹${(cents / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

// Orders have no create/edit form — they only ever come from a customer's
// own checkout (see core-api's OrdersService comment). This is read-only.
export function OrderDetailModal({
  orderId,
  onClose,
  tenantSlug,
}: {
  orderId: string | null;
  onClose: () => void;
  tenantSlug: string | null;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);

  useEffect(() => {
    if (!orderId) return;
    setOrder(null);
    apiFetch(`/orders/${orderId}`, {}, tenantSlug)
      .then((res) => (res.ok ? res.json() : null))
      .then(setOrder)
      .catch(() => setOrder(null));
  }, [orderId, tenantSlug]);

  return (
    <Modal open={!!orderId} onClose={onClose} title="Order details">
      {!order && <p className="text-sm text-muted-foreground">Loading...</p>}
      {order && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Status</span>
            <span className="text-foreground">{order.status}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Placed</span>
            <span className="text-foreground">{new Date(order.createdAt).toLocaleString()}</span>
          </div>
          <div className="border-t border-border pt-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between py-1">
                <span className="text-foreground">
                  {item.productName} &times; {item.quantity}
                </span>
                <span className="text-muted-foreground">{formatPrice(item.priceCents * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-medium text-foreground">
            <span>Subtotal</span>
            <span>{formatPrice(order.subtotalCents)}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
