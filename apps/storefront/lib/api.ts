export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Which store a request is for — resolved from the *actual hostname the
 * visitor used*, the same job core-api's own TenantResolverMiddleware
 * does for itself (see extractSlugFromHost there). This is deliberately
 * not a single fixed value: one storefront deployment serves every
 * tenant, exactly like core-api does — `nike.folkshops.com` and
 * `coffee.folkshops.com` hit the same running process and resolve to
 * different stores. Real subdomain DNS/certs are Phase 6 infra
 * (folkshops-infra, not built yet), but this code needs zero changes
 * once that exists — it already reads whatever Host header shows up.
 *
 * `.localhost` gets special handling: `nike.localhost:3003` is only two
 * label parts ("nike", "localhost"), so the ">2 parts" rule that works
 * for real domains (subdomain.domain.tld) can't tell it apart from a bare
 * apex domain — `.localhost` has no separate domain+TLD to begin with.
 * Modern browsers resolve any `*.localhost` to loopback with zero setup
 * (RFC 6761), so this is a real way to test multiple stores against one
 * running dev server, not a toy.
 *
 * Falls back to NEXT_PUBLIC_STORE_SLUG for a bare hostname with no
 * subdomain (plain `localhost:3000`) — but **only outside production**,
 * mirroring core-api's own TenantResolverMiddleware (`X-Tenant-Id` is
 * dev-only there too, see rule 9). In production a bare/apex hostname
 * genuinely has no store — `folkshops.com` itself is the marketing site,
 * not a tenant — so this returns `null` and the layout renders a "store
 * not found" page instead of silently defaulting to whichever slug the
 * env var happens to hold.
 */
function resolveStoreSlug(host: string | null | undefined): string | null {
  if (host) {
    const hostname = host.split(":")[0].toLowerCase();
    if (hostname.endsWith(".localhost")) {
      const slug = hostname.slice(0, -".localhost".length);
      if (slug && slug !== "www") return slug;
    } else {
      const parts = hostname.split(".");
      if (parts.length > 2 && parts[0] !== "www") return parts[0];
    }
  }
  if (process.env.NODE_ENV !== "production") return process.env.NEXT_PUBLIC_STORE_SLUG ?? "demo";
  return null;
}

export const CUSTOMER_ACCESS_TOKEN_COOKIE = "fk_customer_access_token";

/** Fired after any cart mutation so the header badge re-counts — a path
 * change would do it too, but adding to cart from a product page doesn't
 * navigate, and router.refresh() doesn't change the pathname. */
export const CART_CHANGED_EVENT = "fk:cart-changed";
export function notifyCartChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CART_CHANGED_EVENT));
}

function withStore(slug: string | null, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (slug) headers.set("X-Tenant-Id", slug);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return { ...init, headers };
}

/** Browser-side: reads the tab's own hostname fresh on every call (a
 * long-lived tab could theoretically... it can't actually navigate
 * cross-tenant without a full reload, but resolving it live costs
 * nothing and needs no state). Goes through "/api/..." — next.config.ts's
 * own rewrite proxies this to core-api server-to-server, so the browser
 * never makes a cross-*site* request to core-api directly (see that
 * config's own comment for why that matters: SameSite=Lax silently drops
 * the customer auth cookie otherwise, since the storefront is served from
 * a tenant subdomain). The browser still attaches its own cookies via
 * credentials: "include" — same-origin now, so that's trivial. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const slug = resolveStoreSlug(typeof window !== "undefined" ? window.location.host : null);
  return fetch(`/api${path}`, { ...withStore(slug, init), credentials: "include" });
}

/**
 * Server-side (server components / layouts): reads the incoming request's
 * own Host header via next/headers — the visitor's real hostname, not
 * core-api's. No automatic cookies here, so a page that needs the
 * customer's session forwards the incoming Cookie header explicitly.
 * Public catalog reads pass nothing.
 */
export async function serverFetch(path: string, cookieHeader?: string, init: RequestInit = {}): Promise<Response> {
  const { headers: nextHeaders } = await import("next/headers");
  const host = (await nextHeaders()).get("host");
  const req = withStore(resolveStoreSlug(host), init);
  if (cookieHeader) (req.headers as Headers).set("Cookie", cookieHeader);
  return fetch(`${API_URL}${path}`, { ...req, cache: "no-store" });
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  images: string[];
  priceCents: number;
  status: "draft" | "active" | "archived";
  categoryId: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface CartLine {
  productId: string;
  quantity: number;
  name: string;
  priceCents: number;
  lineTotalCents: number;
}

export interface Cart {
  id: string;
  items: CartLine[];
  subtotalCents: number;
}

export interface Order {
  id: string;
  status: "pending" | "awaiting_payment" | "paid" | "payment_failed" | "cancelled" | "refunded" | "partially_refunded";
  subtotalCents: number;
  createdAt: string;
  items?: { id: string; productName: string; priceCents: number; quantity: number }[];
}
