"use client";

import { Button } from "@folkshops/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, notifyCartChanged } from "../../../lib/api";

export function AddToCart({ productId, signedIn }: { productId: string; signedIn: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [state, setState] = useState<"idle" | "adding" | "added" | "error">("idle");

  async function add() {
    if (!signedIn) {
      router.push(`/login?next=/products/${productId}`);
      return;
    }
    setState("adding");
    const res = await apiFetch("/storefront/cart/items", { method: "POST", body: JSON.stringify({ productId, quantity: qty }) });
    if (res.status === 401) {
      router.push(`/login?next=/products/${productId}`);
      return;
    }
    setState(res.ok ? "added" : "error");
    if (res.ok) {
      notifyCartChanged();
      setTimeout(() => setState("idle"), 1800);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-11 items-center rounded-full border border-border">
          <button type="button" onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="Decrease quantity" className="h-full w-10 rounded-l-full text-lg transition-colors hover:bg-muted active:scale-95">
            &minus;
          </button>
          <span className="w-8 text-center text-sm tabular-nums">{qty}</span>
          <button type="button" onClick={() => setQty((n) => Math.min(99, n + 1))} aria-label="Increase quantity" className="h-full w-10 rounded-r-full text-lg transition-colors hover:bg-muted active:scale-95">
            +
          </button>
        </div>
        <Button variant="primary" onClick={add} disabled={state === "adding"} className="h-11 flex-1 rounded-full text-sm">
          {state === "adding" ? "Adding..." : state === "added" ? "Added to cart" : signedIn ? "Add to cart" : "Sign in to buy"}
        </Button>
      </div>
      {state === "error" && <p className="text-sm text-destructive">Couldn&apos;t add that — try again.</p>}
    </div>
  );
}
