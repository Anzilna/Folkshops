"use client";

import { Button, Card, Checkbox, Field, Input } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../../../lib/api";
import { errorMessage } from "../../../lib/hooks";

export interface CustomerRow {
  id: string;
  phone: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
}

export function CustomerForm({ customer, tenantSlug }: { customer: CustomerRow | null; tenantSlug: string | null }) {
  const router = useRouter();
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [name, setName] = useState(customer?.name ?? "");
  const [isActive, setIsActive] = useState(customer?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // phone is only sent on create — it's the customer's OTP login
      // identity, and changing it isn't a plain field edit (see core-api's
      // UpdateCustomerDto).
      const body = customer ? { name: name || undefined, isActive } : { phone, name: name || undefined, isActive };
      const res = await apiFetch(
        customer ? `/customers/${customer.id}` : "/customers",
        { method: customer ? "PATCH" : "POST", body: JSON.stringify(body) },
        tenantSlug,
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Save failed"));
      router.push("/customers");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-6">
      <Card className="flex flex-col gap-5">
        <Field
          label="Phone"
          htmlFor="cu-phone"
          hint={customer ? "The phone number is the customer's login and can't be changed here." : "Include the country code, e.g. +91 98765 43210."}
        >
          <Input id="cu-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required disabled={!!customer} autoFocus={!customer} />
        </Field>
        <Field label="Name" htmlFor="cu-name">
          <Input id="cu-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!customer} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </Card>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Link href="/customers">
          <Button variant="outline" type="button">
            Cancel
          </Button>
        </Link>
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? "Saving..." : customer ? "Save changes" : "Add customer"}
        </Button>
      </div>
    </form>
  );
}
