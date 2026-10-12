"use client";

import { Button, Field, Input } from "@folkshops/ui";
import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { WhatsAppOptIn } from "../whatsapp-opt-in";

export function AccountForm({
  initialName,
  phone,
  initialWhatsAppOptIn,
  storeName,
}: {
  initialName: string | null;
  phone: string;
  initialWhatsAppOptIn: boolean;
  storeName?: string;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [whatsappOptIn, setWhatsAppOptIn] = useState(initialWhatsAppOptIn);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function save(body: { name?: string; whatsappOptIn?: boolean }) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/storefront/auth/me", { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Couldn't save — try again.");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save — try again.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await save({ name });
  }

  // A consent toggle saves on change — making someone also press Save for
  // a checkbox is how opt-outs silently don't happen.
  async function onToggleWhatsApp(next: boolean) {
    setWhatsAppOptIn(next);
    if (!(await save({ whatsappOptIn: next }))) setWhatsAppOptIn(!next);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Phone" htmlFor="acct-phone" hint="Your login identity — can't be changed here.">
        <Input id="acct-phone" value={phone} disabled className="tabular-nums" />
      </Field>
      <Field label="Name" htmlFor="acct-name">
        <Input id="acct-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add your name" autoFocus />
      </Field>
      <WhatsAppOptIn checked={whatsappOptIn} onChange={onToggleWhatsApp} storeName={storeName} phone={phone} disabled={submitting} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button variant="primary" type="submit" disabled={submitting} className="rounded-full">
          {submitting ? "Saving..." : "Save"}
        </Button>
        {saved && <span className="fk-fade-in text-sm text-success">Saved</span>}
      </div>
    </form>
  );
}
