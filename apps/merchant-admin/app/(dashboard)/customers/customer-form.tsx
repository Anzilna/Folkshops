"use client";

import { Button, Input, Label, Modal } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

export interface CustomerRow {
  id: string;
  phone: string;
  name: string | null;
}

export function CustomerForm({
  open,
  onClose,
  onSaved,
  customer,
  tenantSlug,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  customer: CustomerRow | null;
  tenantSlug: string | null;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhone(customer?.phone ?? "");
    setName(customer?.name ?? "");
    setError(null);
  }, [open, customer]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // phone is only sent on create — a customer's phone is their login
      // identity (OTP goes to it), editing it isn't a plain field update.
      const body = customer ? { name: name || undefined } : { phone, name: name || undefined };
      const res = await apiFetch(
        customer ? `/customers/${customer.id}` : "/customers",
        { method: customer ? "PATCH" : "POST", body: JSON.stringify(body) },
        tenantSlug,
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(Array.isArray(errBody?.message) ? errBody.message.join(", ") : (errBody?.message ?? "Save failed"));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={customer ? "Edit customer" : "New customer"}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cu-phone">Phone</Label>
          <Input id="cu-phone" value={phone} onChange={(e) => setPhone(e.target.value)} required disabled={!!customer} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cu-name">Name</Label>
          <Input id="cu-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
