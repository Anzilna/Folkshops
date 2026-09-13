"use client";

import { useEffect, useState } from "react";
import { apiFetch, getStoredTenantSlug } from "./api";

/** The dev-only tenant slug, read from document.cookie once mounted. */
export function useTenantSlug(): string | null {
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => {
    setSlug(getStoredTenantSlug(document.cookie));
  }, []);
  return slug;
}

/** Fetches one record for an edit/detail page. Waits for the tenant slug
 * (null on first render) before firing, so the request always carries it. */
export function useResource<T>(path: string | null) {
  const tenantSlug = useTenantSlug();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path || tenantSlug === null) return;
    let cancelled = false;
    setLoading(true);
    apiFetch(path, {}, tenantSlug)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Not found" : `Failed to load (${res.status})`);
        return (await res.json()) as T;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tenantSlug]);

  return { data, loading, error, tenantSlug };
}

/** Extracts the message from a core-api error body (class-validator
 * returns an array of messages, everything else a string). */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  if (Array.isArray(body?.message)) return body.message.join(", ");
  return body?.message ?? fallback;
}
