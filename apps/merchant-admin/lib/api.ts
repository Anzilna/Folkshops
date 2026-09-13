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
