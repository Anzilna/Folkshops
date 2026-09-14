"use client";

import { Button, Field, Input } from "@folkshops/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, getStoredTenantSlug, tenantSlugCookieString } from "../../lib/api";

export function LoginForm() {
  const router = useRouter();
  const [rememberedSlug, setRememberedSlug] = useState<string | null | undefined>(undefined); // undefined = not checked yet
  const [switching, setSwitching] = useState(false); // user asked to use a different store
  const [storeSlug, setStoreSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Cookie only exists in the browser — resolved post-mount, same pattern
  // as lib/hooks.ts's useTenantSlug. A remembered slug means this browser
  // has logged into a store before, so there's no need to ask again: the
  // field only reappears if that login fails or the user explicitly asks
  // to switch stores.
  useEffect(() => {
    setRememberedSlug(getStoredTenantSlug(document.cookie));
  }, []);

  const usingRememberedSlug = !!rememberedSlug && !switching;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const slug = usingRememberedSlug ? rememberedSlug! : storeSlug;
      const res = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, slug);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // A remembered slug can be stale (wrong store, or the merchant
        // switched stores on this browser before) — surface the field
        // instead of leaving them stuck retrying against the same guess.
        if (usingRememberedSlug) {
          setStoreSlug(rememberedSlug!);
          setSwitching(true);
        }
        throw new Error(body?.message ?? "Login failed");
      }
      // Remembers which store this session is for — see lib/api.ts for why
      // this exists only because there's no real subdomain in local dev.
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
      {usingRememberedSlug ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <span>
            Signing in to <span className="font-medium text-foreground">{rememberedSlug}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setStoreSlug(rememberedSlug ?? "");
              setSwitching(true);
            }}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Switch store
          </button>
        </div>
      ) : (
        rememberedSlug !== undefined && (
          <Field label="Store slug" htmlFor="storeSlug">
            <Input id="storeSlug" value={storeSlug} onChange={(e) => setStoreSlug(e.target.value)} required placeholder="nike" autoFocus />
          </Field>
        )
      )}

      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={usingRememberedSlug} />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button variant="primary" type="submit" disabled={submitting || rememberedSlug === undefined}>
        {submitting ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
