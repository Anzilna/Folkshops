"use client";

import { Button, Field, Input } from "@folkshops/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, getStoredTenantSlug, TENANT_SLUG_COOKIE, tenantSlugCookieString } from "../../lib/api";

/**
 * One screen: email, password, sign in. The store slug is resolved
 * behind the scenes (POST /auth/identify, via membership_lookup — see
 * that table's own comment) and never shown to the merchant. A returning
 * browser skips that lookup entirely using the remembered slug cookie.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let slug = getStoredTenantSlug(document.cookie);

      if (!slug) {
        const idRes = await apiFetch("/auth/identify", { method: "POST", body: JSON.stringify({ email }) });
        if (!idRes.ok) throw new Error("Couldn't sign in — try again.");
        const { stores }: { stores: { slug: string; name: string }[] } = await idRes.json();
        if (stores.length === 0) throw new Error("No account found for that email.");
        if (stores.length > 1) throw new Error("Multiple stores found for this email — contact support.");
        slug = stores[0].slug;
      }

      const res = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, slug);
      if (!res.ok) {
        // A remembered slug can be stale (different store used on this
        // browser since) — drop it (max-age=0 expires immediately,
        // unlike tenantSlugCookieString which always sets a 30-day one)
        // so the next attempt re-identifies instead of retrying the same
        // bad guess forever.
        document.cookie = `${TENANT_SLUG_COOKIE}=; path=/; max-age=0`;
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? "Invalid email or password.");
      }

      document.cookie = tenantSlugCookieString(slug);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button variant="primary" type="submit" disabled={submitting}>
        {submitting ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
