"use client";

import { Button, Field, Input } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, tenantSlugCookieString } from "../../lib/api";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 63);
}

/** The only way a new store gets created — before this page existed, the
 * only path was a raw curl to POST /auth/register. Register + first login
 * happen in one step: the backend already returns a valid session (see
 * AuthController.register setting the same cookies login does), this just
 * also needs to remember the slug the same way login does. */
export function RegisterForm() {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [storeSlug, setStoreSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ storeName, storeSlug, name, email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(Array.isArray(body?.message) ? body.message.join(", ") : (body?.message ?? "Couldn't create your store."));
      }
      document.cookie = tenantSlugCookieString(storeSlug);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your store.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
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

      <Button variant="primary" type="submit" disabled={submitting}>
        {submitting ? "Creating your store..." : "Create store"}
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
