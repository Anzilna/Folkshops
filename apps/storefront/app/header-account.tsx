"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, CART_CHANGED_EVENT, type Cart } from "../lib/api";

/**
 * The signed-in/out half of the header. `signedIn` is only the cookie's
 * presence (cheap, from the layout); the cart count is fetched client-side
 * so the layout itself stays cacheable and a bad/expired cookie just
 * means "no badge", never an error page.
 */
export function HeaderAccount({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    function recount() {
      apiFetch("/storefront/cart")
        .then((res) => (res.ok ? (res.json() as Promise<Cart>) : null))
        .then((cart) => {
          if (!cancelled && cart) setCount(cart.items.reduce((n, l) => n + l.quantity, 0));
        })
        .catch(() => {});
    }
    recount();
    // Re-count on navigation and whenever a page reports a cart mutation.
    window.addEventListener(CART_CHANGED_EVENT, recount);
    return () => {
      cancelled = true;
      window.removeEventListener(CART_CHANGED_EVENT, recount);
    };
  }, [signedIn, pathname]);

  async function signOut() {
    await apiFetch("/storefront/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const linkCls = "rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  if (!signedIn) {
    return (
      <Link href="/login" className={linkCls}>
        Sign in
      </Link>
    );
  }

  return (
    <>
      <Link href="/orders" className={linkCls}>
        Orders
      </Link>
      <Link href="/cart" className={`${linkCls} relative inline-flex items-center gap-1.5`} aria-label={count ? `Cart, ${count} items` : "Cart"}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 3h12l1 5H5l1-5zM5 8h14l-1.2 11.2A2 2 0 0115.8 21H8.2a2 2 0 01-2-1.8L5 8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
        Cart
        {count ? (
          <span className="fk-pop ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
            {count}
          </span>
        ) : null}
      </Link>
      <button type="button" onClick={signOut} className={linkCls}>
        Sign out
      </button>
    </>
  );
}
