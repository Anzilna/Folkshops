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
 * Falls back to NEXT_PUBLIC_STORE_SLUG only for a bare hostname with no
 * subdomain at all (plain `localhost:3003`) — keeps the simple
 * single-store dev workflow from earlier this session working unchanged.
 */
function resolveStoreSlug(host: string | null | undefined): string {
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
  return process.env.NEXT_PUBLIC_STORE_SLUG ?? "demo";
}

export const CUSTOMER_ACCESS_TOKEN_COOKIE = "fk_customer_access_token";

/** Fired after any cart mutation so the header badge re-counts — a path
 * change would do it too, but adding to cart from a product page doesn't
 * navigate, and router.refresh() doesn't change the pathname. */
export const CART_CHANGED_EVENT = "fk:cart-changed";
export function notifyCartChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CART_CHANGED_EVENT));
}

function withStore(slug: string, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("X-Tenant-Id", slug);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return { ...init, headers };
}

/** Browser-side: reads the tab's own hostname fresh on every call (a
 * long-lived tab could theoretically... it can't actually navigate
 * cross-tenant without a full reload, but resolving it live costs
 * nothing and needs no state). The browser attaches customer cookies
 * itself via credentials: "include". */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const slug = resolveStoreSlug(typeof window !== "undefined" ? window.location.host : null);
  return fetch(`${API_URL}${path}`, { ...withStore(slug, init), credentials: "include" });
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
  status: "pending" | "cancelled";
  subtotalCents: number;
  createdAt: string;
  items?: { id: string; productName: string; priceCents: number; quantity: number }[];
}
