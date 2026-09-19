"use client";

import { Button } from "@folkshops/ui";
import { useState } from "react";
import { apiFetch } from "../../../lib/api";

/** Reused (not re-minted) across a page refresh mid-payment — a fresh
 * Idempotency-Key on every render would defeat the whole point, since the
 * backend's idempotency is keyed on this exact string. Cleared implicitly
 * once the order is paid (a paid order never renders this component
 * again, see OrderPage). */
function getOrCreateIdempotencyKey(orderId: string): string {
  const storageKey = `fk-payment-key-${orderId}`;
  let value = sessionStorage.getItem(storageKey);
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem(storageKey, value);
  }
  return value;
}

/**
 * Stripe Checkout is a hosted redirect, not a client-side widget — no
 * script tag, no `handler` callback to verify. The backend returns a
 * ready-to-visit Stripe URL; this just sends the browser there. Stripe
 * redirects back to this same order page (?paid=1 or ?canceled=1) once
 * the customer finishes or abandons — the webhook (server-to-server) is
 * still the authoritative confirmation, this redirect is only ever
 * optimistic UI.
 */
export function StripeCheckoutButton({ orderId }: { orderId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      const idempotencyKey = getOrCreateIdempotencyKey(orderId);
      const returnUrl = `${window.location.origin}/orders/${orderId}`;
      const res = await apiFetch(`/storefront/orders/${orderId}/pay`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey, returnUrl }),
      });
      if (!res.ok) throw new Error("Couldn't start payment — please try again.");
      const info: { url: string } = await res.json();
      window.location.href = info.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start payment — please try again.");
      setPaying(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button variant="primary" onClick={pay} disabled={paying} className="h-11 rounded-full">
        {paying ? "Redirecting to Stripe..." : "Pay now"}
      </Button>
    </div>
  );
}
