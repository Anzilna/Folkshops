"use client";

import { Button } from "@folkshops/ui";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../../../lib/api";

// Not shipped with @types — checkout.js is a plain global script, not an
// npm package, same as any other third-party widget loaded via next/script.
declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

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

export function RazorpayCheckout({ orderId, storeName }: { orderId: string; storeName: string }) {
  const router = useRouter();
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      const idempotencyKey = getOrCreateIdempotencyKey(orderId);
      const res = await apiFetch(`/storefront/orders/${orderId}/pay`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey }),
      });
      if (!res.ok) throw new Error("Couldn't start payment — please try again.");
      const info: { providerOrderId: string; amountCents: number; currency: string; keyId: string } = await res.json();

      const razorpay = new window.Razorpay({
        key: info.keyId,
        order_id: info.providerOrderId,
        amount: info.amountCents,
        currency: info.currency,
        name: storeName,
        handler: async (response: RazorpayHandlerResponse) => {
          try {
            const verifyRes = await apiFetch(`/storefront/orders/${orderId}/verify-payment`, {
              method: "POST",
              body: JSON.stringify({
                idempotencyKey,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            if (!verifyRes.ok) throw new Error();
            router.push(`/orders/${orderId}?paid=1`);
            router.refresh();
          } catch {
            // The webhook is the real source of truth and will resolve
            // this shortly either way — this just means the storefront
            // couldn't optimistically confirm it in the same request.
            setError("We received your payment but couldn't confirm it yet — refresh this page in a moment.");
            setPaying(false);
          }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      razorpay.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start payment — please try again.");
      setPaying(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" onReady={() => setScriptReady(true)} />
      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button variant="primary" onClick={pay} disabled={paying || !scriptReady} className="h-11 rounded-full">
        {paying ? "Opening payment..." : "Pay now"}
      </Button>
    </div>
  );
}
