"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, tenantSlugCookieString } from "../../lib/api";

export function LoginForm() {
  const router = useRouter();
  const [storeSlug, setStoreSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, storeSlug);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? "Login failed");
      }
      // Remembers which store this session is for — see lib/api.ts for why
      // this exists only because there's no real subdomain in local dev.
      document.cookie = tenantSlugCookieString(storeSlug);
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
      <div className="flex flex-col gap-1">
        <label htmlFor="storeSlug" className="text-sm text-muted-foreground">
          Store slug
        </label>
        <input
          id="storeSlug"
          value={storeSlug}
          onChange={(e) => setStoreSlug(e.target.value)}
          required
          className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
          placeholder="nike"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm text-muted-foreground">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm text-muted-foreground">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {submitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
