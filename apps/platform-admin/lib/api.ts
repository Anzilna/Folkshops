import type { PaginatedResult, TableQueryParams } from "@folkshops/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export { API_URL };

/** For use in the browser (client components) — the browser attaches cookies itself via credentials: "include". */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
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

/** Same shape as merchant-admin's lib/api.ts — no tenant slug here, since
 * platform admins are global (no tenant scoping at all). */
export function createTableFetcher<T>(path: string) {
  return async (params: TableQueryParams): Promise<PaginatedResult<T>> => {
    const res = await apiFetch(`${path}?${buildTableQueryString(params)}`);
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.json();
  };
}

export function createExportFetcher(path: string) {
  return async (params: TableQueryParams): Promise<Blob> => {
    const res = await apiFetch(`${path}?${buildTableQueryString(params)}`);
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  };
}
