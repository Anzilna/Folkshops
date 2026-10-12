"use client";

import { Button, Field, Input } from "@folkshops/ui";
import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "../../lib/api";

/**
 * The confirmation screen is identical whether or not the email has an
 * account — core-api answers the same way for both (see
 * PasswordResetService.requestReset()), and this page mustn't undo that
 * by wording the two cases differently.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      if (res.status === 429) throw new Error("Too many requests — wait a minute and try again.");
      if (!res.ok) throw new Error("Couldn't send the email — try again.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="fk-fade-in flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border p-5 text-sm">
        <p>
          If <span className="font-medium">{email}</span> has a Folkshops account, a reset link is on its way. It expires in 30 minutes.
        </p>
        <p className="text-muted-foreground">Nothing arrived? Check spam, or wait a minute and send another.</p>
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" type="button" onClick={() => setSent(false)}>
            Send again
          </Button>
          <Link href="/login" className="text-sm font-medium underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </Field>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button variant="primary" type="submit" disabled={submitting}>
        {submitting ? "Sending..." : "Send reset link"}
      </Button>
      <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
