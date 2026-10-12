"use client";

import { Button, Field, Input } from "@folkshops/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../../lib/api";

const MIN_LENGTH = 8; // Same as core-api's ResetPasswordDto / RegisterDto.

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4 text-center text-sm">
        <p className="text-muted-foreground">This reset link is incomplete. Open the link from your email again, or request a new one.</p>
        <Link href="/forgot-password" className="font-medium underline-offset-4 hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="fk-fade-in flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border p-5 text-sm">
        <p>Your password has been changed. For safety, you&apos;ve been signed out on every device.</p>
        <Button variant="primary" type="button" onClick={() => router.push("/login")}>
          Sign in
        </Button>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
        throw new Error(res.status === 429 ? "Too many attempts — wait a minute and try again." : (message ?? "Couldn't reset your password."));
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const expired = error?.includes("expired");

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <Field label="New password" htmlFor="password">
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <Input id="confirm" type="password" autoComplete="new-password" minLength={MIN_LENGTH} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <p className="-mt-2 text-xs text-muted-foreground">At least {MIN_LENGTH} characters.</p>

      {error && (
        <p className="text-sm text-destructive">
          {error}{" "}
          {expired && (
            <Link href="/forgot-password" className="font-medium underline underline-offset-4">
              Request a new link
            </Link>
          )}
        </p>
      )}

      <Button variant="primary" type="submit" disabled={submitting}>
        {submitting ? "Saving..." : "Set new password"}
      </Button>
    </form>
  );
}
