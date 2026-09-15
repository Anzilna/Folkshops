"use client";

import { Button } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, notifyCartChanged, type Cart } from "../../lib/api";
import { formatPrice } from "../../lib/format";

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // productId being changed, or "checkout"
  // null while loading — deliberately distinct from false, so the
  // checkout button doesn't flash "not accepting payments" for a moment
  // before the real answer arrives.
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean | null>(null);

  async function load() {
    const [cartRes, storeRes] = await Promise.all([apiFetch("/storefront/cart"), apiFetch("/storefront/store")]);
    if (cartRes.status === 401) {
      router.push("/login?next=/cart");
      return;
    }
    if (!cartRes.ok) {
      setError("Couldn't load your cart.");
      return;
    }
    setCart(await cartRes.json());
    if (storeRes.ok) {
      const store: { paymentsEnabled: boolean } = await storeRes.json();
      setPaymentsEnabled(store.paymentsEnabled);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setQuantity(productId: string, quantity: number) {
    setBusy(productId);
    const res =
      quantity <= 0
        ? await apiFetch(`/storefront/cart/items/${productId}`, { method: "DELETE" })
        : await apiFetch(`/storefront/cart/items/${productId}`, { method: "PATCH", body: JSON.stringify({ quantity }) });
    if (res.ok) {
      setCart(await res.json());
      notifyCartChanged();
    }
    setBusy(null);
  }

  async function checkout() {
    setBusy("checkout");
    setError(null);
    const res = await apiFetch("/storefront/orders/checkout", { method: "POST" });
    if (!res.ok) {
      setError("Checkout failed — please try again.");
      setBusy(null);
      return;
    }
    const order = await res.json();
    notifyCartChanged();
    router.push(`/orders/${order.id}?placed=1`);
  }

  if (!cart && !error) {
    return <div className="mx-auto h-48 max-w-2xl animate-pulse rounded-2xl bg-muted/50" />;
  }

  const units = cart?.items.reduce((n, l) => n + l.quantity, 0) ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <h1 className="sf-display text-3xl font-semibold">
        Your cart{units > 0 && <span className="text-muted-foreground"> · {units}</span>}
      </h1>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {cart && cart.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-20 text-center">
          <p className="text-sm text-muted-foreground">Nothing in your cart yet.</p>
          <Link href="/" className="mt-3 inline-block text-sm underline underline-offset-4">
            Keep shopping
          </Link>
        </div>
      ) : (
        cart && (
          <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {cart.items.map((line) => (
                <li key={line.productId} className="flex items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <Link href={`/products/${line.productId}`} className="text-sm font-medium hover:underline underline-offset-4">
                      {line.name}
                    </Link>
                    <p className="text-xs text-muted-foreground tabular-nums">{formatPrice(line.priceCents)} each</p>
                  </div>
                  <div className="inline-flex h-9 items-center rounded-full border border-border">
                    <button type="button" disabled={busy === line.productId} onClick={() => setQuantity(line.productId, line.quantity - 1)} aria-label="Decrease" className="h-full w-9 rounded-l-full transition-colors hover:bg-muted active:scale-95 disabled:opacity-50">
                      &minus;
                    </button>
                    <span className="w-7 text-center text-sm tabular-nums">{line.quantity}</span>
                    <button type="button" disabled={busy === line.productId} onClick={() => setQuantity(line.productId, line.quantity + 1)} aria-label="Increase" className="h-full w-9 rounded-r-full transition-colors hover:bg-muted active:scale-95 disabled:opacity-50">
                      +
                    </button>
                  </div>
                  <span className="w-24 text-right text-sm font-medium tabular-nums">{formatPrice(line.lineTotalCents)}</span>
                  <button type="button" onClick={() => setQuantity(line.productId, 0)} aria-label={`Remove ${line.name}`} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>

            <aside className="flex h-fit flex-col gap-4 rounded-2xl border border-border p-5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatPrice(cart.subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Delivery</span>
                <span className="text-muted-foreground">&mdash;</span>
              </div>
              <div className="flex justify-between border-t border-border pt-4 text-base font-medium">
                <span>Total</span>
                <span className="tabular-nums">{formatPrice(cart.subtotalCents)}</span>
              </div>
              {paymentsEnabled === false ? (
                <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-center text-sm text-muted-foreground">
                  This store isn&apos;t accepting payments yet — check back soon.
                </p>
              ) : (
                <>
                  <Button
                    variant="primary"
                    onClick={checkout}
                    disabled={busy === "checkout" || paymentsEnabled !== true}
                    className="h-11 rounded-full"
                  >
                    {busy === "checkout" ? "Placing order..." : "Continue to payment"}
                  </Button>
                  <p className="text-xs text-muted-foreground">You&apos;ll pay on the next screen via Razorpay.</p>
                </>
              )}
            </aside>
          </div>
        )
      )}
    </div>
  );
}
