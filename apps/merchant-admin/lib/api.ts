import type { ImportResult, PaginatedResult, TableQueryParams } from "@folkshops/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Dev-only: core-api resolves the tenant from the hostname subdomain in
 * production (nike.folkshops.com -> "nike"), but merchant-admin has no
 * subdomain locally — it's just localhost:3001. core-api's own docs
 * already establish X-Tenant-Id as the dev-only override for exactly this
 * (never honored when NODE_ENV=production on the core-api side), so the
 * frontend just needs to remember which store the merchant logged into and
 * keep sending it. Stored in a plain (non-httpOnly) cookie because this
 * value isn't a secret — it's a slug, and both server components and
 * client components need to read it.
 */
const TENANT_SLUG_COOKIE = "fk_dev_tenant_slug";

export function getStoredTenantSlug(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${TENANT_SLUG_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function tenantSlugCookieString(slug: string): string {
  return `${TENANT_SLUG_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=${60 * 60 * 24 * 30}`;
}

export { API_URL, TENANT_SLUG_COOKIE };

/** For use in the browser (client components) — the browser attaches cookies itself via credentials: "include". */
export async function apiFetch(path: string, init: RequestInit = {}, tenantSlug?: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (tenantSlug) headers.set("X-Tenant-Id", tenantSlug);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}

/** Reads the dev-only tenant-slug cookie from the browser's own document.cookie
 * — the client-component counterpart to getStoredTenantSlug(), which takes a
 * server-side Cookie header string instead. */
function currentTenantSlug(): string | null {
  if (typeof document === "undefined") return null;
  return getStoredTenantSlug(document.cookie);
}

function buildTableQueryString(params: TableQueryParams): string {
  const sp = new URLSearchParams();
  sp.set("page", String(params.page));
  sp.set("limit", String(params.limit));
  if (params.sortBy) sp.set("sortBy", params.sortBy);
  if (params.sortDir) sp.set("sortDir", params.sortDir);
  if (params.search) sp.set("search", params.search);
  for (const [key, value] of Object.entries(params.filters)) {
    if (value) sp.set(key, value);
  }
  return sp.toString();
}

/**
 * The three functions every list page hands to @folkshops/ui's DataTable —
 * one call each wires up paginated fetch/export/import against a given
 * core-api resource path, so a page component only needs its columns and
 * these three lines, not a hand-rolled fetch per page.
 */
export function createTableFetcher<T>(path: string) {
  return async (params: TableQueryParams): Promise<PaginatedResult<T>> => {
    const res = await apiFetch(`${path}?${buildTableQueryString(params)}`, {}, currentTenantSlug());
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.json();
  };
}

export function createExportFetcher(path: string) {
  return async (params: TableQueryParams): Promise<Blob> => {
    const res = await apiFetch(`${path}?${buildTableQueryString(params)}`, {}, currentTenantSlug());
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  };
}

export function createImportFetcher(path: string) {
  return async (rows: Record<string, string>[]): Promise<ImportResult> => {
    const res = await apiFetch(path, { method: "POST", body: JSON.stringify({ rows }) }, currentTenantSlug());
    if (!res.ok) throw new Error(`Import failed (${res.status})`);
    return res.json();
  };
}
