"use client";

import { Button, Field, Input } from "@folkshops/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, getStoredTenantSlug, tenantSlugCookieString } from "../../lib/api";

interface StoreOption {
  slug: string;
  name: string;
}

// "remembered" = a slug cookie already exists (fast path, no /auth/identify
// round trip needed) · "email" = ask for the email, then resolve the store(s)
// via POST /auth/identify · "picker" = identify found more than one store,
// ask which · "password" = store resolved (one way or the other), ask for
// the password and submit /auth/login.
type Step = "remembered" | "email" | "picker" | "password";

/**
 * Nobody types a store slug here anymore — /auth/identify resolves it from
 * the email (see AuthService.identify() and membership_lookup's own
 * comment for why that table exists). The actual /auth/login call is
 * unchanged: it still verifies the password against the specific tenant's
 * membership, exactly as before — this only automates picking *which*
 * tenant to attempt that against.
 */
export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step | null>(null); // null = still checking for a remembered slug
  const [rememberedSlug, setRememberedSlug] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [resolvedStore, setResolvedStore] = useState<StoreOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const slug = getStoredTenantSlug(document.cookie);
    setRememberedSlug(slug);
    setStep(slug ? "remembered" : "email");
  }, []);

  function backToEmail() {
    setStep("email");
    setStores([]);
    setResolvedStore(null);
    setPassword("");
    setError(null);
  }

  async function onIdentify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/auth/identify", { method: "POST", body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error("Couldn't look that up — try again.");
      const { stores: found }: { stores: StoreOption[] } = await res.json();
      if (found.length === 0) {
        setError("No account found for that email.");
      } else if (found.length === 1) {
        setResolvedStore(found[0]);
        setStep("password");
      } else {
        setStores(found);
        setStep("picker");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't look that up — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function pickStore(store: StoreOption) {
    setResolvedStore(store);
    setStep("password");
    setError(null);
  }

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const slug = step === "remembered" ? rememberedSlug! : resolvedStore!.slug;
      const res = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, slug);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // A remembered slug can be stale (the merchant used a different
        // store on this browser since) — fall back to asking for the
        // email again instead of leaving them stuck retrying a guess.
        if (step === "remembered") {
          setRememberedSlug(null);
          backToEmail();
          throw new Error("That didn't work for the remembered store — sign in again below.");
        }
        throw new Error(body?.message ?? "Login failed");
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

  if (step === null) return <div className="h-40 w-full max-w-sm" />; // avoid a flash before the cookie check resolves

  if (step === "email") {
    return (
      <form onSubmit={onIdentify} className="flex w-full max-w-sm flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? "Checking..." : "Continue"}
        </Button>
      </form>
    );
  }

  if (step === "picker") {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{email} has access to multiple stores</span>
          <button type="button" onClick={backToEmail} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Not you?
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {stores.map((store) => (
            <button
              key={store.slug}
              type="button"
              onClick={() => pickStore(store)}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left text-sm transition-colors hover:border-foreground/30 hover:bg-muted"
            >
              <span className="font-medium text-foreground">{store.name}</span>
              <span className="text-xs text-muted-foreground">{store.slug}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // step is "remembered" or "password" — both just need the password.
  const storeName = step === "remembered" ? rememberedSlug : resolvedStore?.name;
  return (
    <form onSubmit={onSubmitPassword} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
        <span>
          {step === "remembered" ? (
            <>
              Signing in to <span className="font-medium text-foreground">{storeName}</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{email}</span> at <span className="font-medium text-foreground">{storeName}</span>
            </>
          )}
        </span>
        <button
          type="button"
          onClick={step === "remembered" ? backToEmail : () => setStep(stores.length > 1 ? "picker" : "email")}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {step === "remembered" ? "Switch store" : "Back"}
        </button>
      </div>

      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </Field>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button variant="primary" type="submit" disabled={submitting}>
        {submitting ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
