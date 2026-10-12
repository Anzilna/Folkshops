"use client";

import { Button, Field, Input } from "@folkshops/ui";
import { useState } from "react";
import { changePassword } from "../../../lib/platform-api";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Current password" htmlFor="pw-current">
        <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="New password" htmlFor="pw-new" hint="At least 8 characters.">
        <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} maxLength={72} required />
      </Field>
      <Field label="Confirm new password" htmlFor="pw-confirm">
        <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} maxLength={72} required />
      </Field>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {done && (
        <p role="status" className="text-sm text-success">
          Password changed. Your other sessions have been signed out.
        </p>
      )}

      <Button variant="primary" type="submit" disabled={submitting} className="self-end">
        {submitting ? "Saving..." : "Change password"}
      </Button>
    </form>
  );
}
