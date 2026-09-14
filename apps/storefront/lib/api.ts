export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Which store this storefront is. Production resolves it from the
 * hostname on the core-api side; locally there's no subdomain, so the
 * slug comes from env and rides along as the dev-only X-Tenant-Id header
 * (see .env.example). Unlike merchant-admin there's no cookie: a shopper
 * doesn't pick a store, the deployment *is* the store.
 */
export const STORE_SLUG = process.env.NEXT_PUBLIC_STORE_SLUG ?? "demo";

export const CUSTOMER_ACCESS_TOKEN_COOKIE = "fk_customer_access_token";

/** Fired after any cart mutation so the header badge re-counts — a path
 * change would do it too, but adding to cart from a product page doesn't
 * navigate, and router.refresh() doesn't change the pathname. */
export const CART_CHANGED_EVENT = "fk:cart-changed";
export function notifyCartChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CART_CHANGED_EVENT));
}

function withStore(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("X-Tenant-Id", STORE_SLUG);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return { ...init, headers };
}

/** Browser-side: the browser attaches the customer cookies itself. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, { ...withStore(init), credentials: "include" });
}

/**
 * Server-side (server components / layouts): no automatic cookies here, so
 * a page that needs the customer's session forwards the incoming Cookie
 * header explicitly. Public catalog reads pass nothing.
 */
export async function serverFetch(path: string, cookieHeader?: string, init: RequestInit = {}): Promise<Response> {
  const req = withStore(init);
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
