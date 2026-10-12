"use client";

import { Button, Field, Input } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, tenantSlugCookieString } from "../../lib/api";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 63);
}

interface Plan {
  slug: string;
  name: string;
  priceCents: number;
  currency: string;
  maxProducts: number | null;
}

function formatPlanPrice(plan: Plan): string {
  if (plan.priceCents === 0) return "Free";
  return `${plan.currency.toUpperCase()} ${(plan.priceCents / 100).toLocaleString("en-AE")}/mo`;
}

/**
 * The only way a new store gets created. Register + first login happen in
 * one step: the backend already returns a valid session (see
 * AuthController.register setting the same cookies login does), this just
 * also needs to remember the slug the same way login does.
 *
 * A plan is REQUIRED — AuthService.register() rejects a missing planSlug
 * outright (docs/decisions/0012: there is no publicly reachable "free
 * forever, no payment" path). `initialPlanSlug` pre-selects whatever the
 * marketing /pricing page's "Get started" link carried in, but this page
 * always fetches the real plan list and lets the merchant pick/change —
 * landing here directly (no ?plan= at all) used to just show a bare error
 * with no way to proceed; caught live.
 */
export function RegisterForm({ planSlug: initialPlanSlug }: { planSlug?: string }) {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [storeSlug, setStoreSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | undefined>(initialPlanSlug);

  useEffect(() => {
    apiFetch("/plans")
      .then((res) => (res.ok ? res.json() : []))
      .then((loaded: Plan[]) => setPlans(loaded))
      .catch(() => setPlans([]));
  }, []);

  const selectedPlan = plans?.find((p) => p.slug === selectedSlug) ?? null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedSlug) {
      setError("Choose a plan to continue.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ storeName, storeSlug, name, email, password, planSlug: selectedSlug }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(Array.isArray(body?.message) ? body.message.join(", ") : (body?.message ?? "Couldn't create your store."));
      }
      document.cookie = tenantSlugCookieString(storeSlug);
      if (body?.checkoutUrl) {
        window.location.href = body.checkoutUrl;
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your store.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Plan</span>
        {plans === null && <div className="h-11 animate-pulse rounded-lg bg-muted/40" />}
        {plans?.length === 0 && <p className="text-sm text-muted-foreground">Plans are temporarily unavailable — please try again shortly.</p>}
        {plans?.map((p) => (
          <button
            key={p.slug}
            type="button"
            onClick={() => setSelectedSlug(p.slug)}
            className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
              selectedSlug === p.slug ? "border-accent bg-accent/5" : "border-border hover:bg-muted/40"
            }`}
          >
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.maxProducts === null ? "Unlimited products" : `Up to ${p.maxProducts} products`}</p>
            </div>
            <span className="text-sm font-medium">{formatPlanPrice(p)}</span>
          </button>
        ))}
      </div>

      <Field label="Store name" htmlFor="reg-store-name">
        <Input
          id="reg-store-name"
          value={storeName}
          onChange={(e) => {
            setStoreName(e.target.value);
            if (!slugTouched) setStoreSlug(slugify(e.target.value));
          }}
          required
          autoFocus
          placeholder="Nike India"
        />
      </Field>
      <Field label="Store URL" htmlFor="reg-store-slug" hint="Your customers will shop at this address (once custom domains land).">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Input
            id="reg-store-slug"
            value={storeSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setStoreSlug(slugify(e.target.value));
            }}
            required
            pattern="[a-z0-9\-]{2,63}"
            className="flex-1"
          />
          <span className="whitespace-nowrap">.folkshops.com</span>
        </div>
      </Field>
      <Field label="Your name" htmlFor="reg-name">
        <Input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Email" htmlFor="reg-email">
        <Input id="reg-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password" htmlFor="reg-password" hint="At least 8 characters.">
        <Input id="reg-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button variant="primary" type="submit" disabled={submitting || !selectedSlug}>
        {submitting ? "Creating your store..." : selectedPlan && selectedPlan.priceCents > 0 ? "Continue to payment" : "Create store"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Already have a store?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
