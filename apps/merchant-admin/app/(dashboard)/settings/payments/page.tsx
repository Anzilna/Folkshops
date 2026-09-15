"use client";

import { Button, Card, Field, Input, PageHeader, Select, useBreadcrumbs } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { errorMessage, useTenantSlug } from "../../../../lib/hooks";

// Every value here is exactly as documented at
// razorpay.com/docs/payments/route/integration-guide — confirmed before
// hardcoding, since submitting a value Razorpay doesn't recognize fails
// the whole KYC submission, not just that one field.
const BUSINESS_TYPE_OPTIONS = [
  { value: "individual", label: "Individual" },
  { value: "proprietorship", label: "Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "private_limited", label: "Private Limited" },
  { value: "public_limited", label: "Public Limited" },
  { value: "llp", label: "LLP" },
  { value: "ngo", label: "NGO" },
  { value: "trust", label: "Trust" },
  { value: "society", label: "Society" },
  { value: "educational_institutes", label: "Educational Institute" },
  { value: "not_yet_registered", label: "Not yet registered" },
];

const CATEGORY_OPTIONS = [
  { value: "ecommerce", label: "Ecommerce" },
  { value: "financial_services", label: "Financial Services" },
  { value: "education", label: "Education" },
  { value: "healthcare", label: "Healthcare" },
  { value: "utilities", label: "Utilities" },
  { value: "government", label: "Government" },
  { value: "logistics", label: "Logistics" },
  { value: "tours_and_travel", label: "Tours & Travel" },
  { value: "transport", label: "Transport" },
  { value: "food", label: "Food" },
  { value: "it_and_software", label: "IT & Software" },
  { value: "gaming", label: "Gaming" },
  { value: "media_and_entertainment", label: "Media & Entertainment" },
  { value: "services", label: "Services" },
  { value: "housing", label: "Housing" },
  { value: "not_for_profit", label: "Not for Profit" },
  { value: "social", label: "Social" },
];

interface PaymentAccountRow {
  id: string;
  linkedAccountId: string | null;
  status: string | null;
  live: boolean;
  activatedAt: string | null;
  legalBusinessName: string;
}

export default function PaymentSettingsPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Payments" }]);
  const tenantSlug = useTenantSlug();
  const [account, setAccount] = useState<PaymentAccountRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [legalBusinessName, setLegalBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("individual");
  const [contactName, setContactName] = useState("");
  const [category, setCategory] = useState("ecommerce");
  // Subcategory is category-dependent in Razorpay's own docs (a full
  // mapping isn't built here — see the docs link above) — free text with
  // a sensible default rather than a dropdown that could be wrong for
  // whatever category is picked.
  const [subcategory, setSubcategory] = useState("ecommerce_marketplace");
  const [pan, setPan] = useState("");
  const [gst, setGst] = useState("");
  const [street1, setStreet1] = useState("");
  const [street2, setStreet2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");

  useEffect(() => {
    if (tenantSlug === null) return;
    apiFetch("/payment-accounts/me", {}, tenantSlug)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setAccount(body))
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch(
        "/payment-accounts",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            phone,
            legalBusinessName,
            businessType,
            contactName,
            category,
            subcategory,
            pan: pan || undefined,
            gst: gst || undefined,
            registeredAddress: { street1, street2: street2 || undefined, city, state, postalCode, country: "IN" },
          }),
        },
        tenantSlug,
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Couldn't submit"));
      setAccount(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await apiFetch("/payment-accounts/refresh", { method: "POST" }, tenantSlug);
      if (!res.ok) throw new Error(await errorMessage(res, "Couldn't refresh status"));
      setAccount(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't refresh status");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Payments" />
        <Card className="h-64 animate-pulse bg-muted/40" />
      </>
    );
  }

  if (account) {
    return (
      <>
        <PageHeader title="Payments" description={account.legalBusinessName} />
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span
                className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${
                  account.live ? "bg-success/15 text-success" : "bg-accent/10 text-accent"
                }`}
              >
                {account.live ? "Active — accepting payments" : "Pending Razorpay review"}
              </span>
              {!account.live && (
                <p className="max-w-md text-sm text-muted-foreground">
                  Razorpay reviews every new account before it can accept live payments. This can take some time — check back
                  and refresh the status below.
                </p>
              )}
            </div>
            <Button variant="outline" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Checking..." : "Refresh status"}
            </Button>
          </div>
          {account.linkedAccountId && (
            <p className="text-xs text-muted-foreground">
              Linked account: <span className="font-mono">{account.linkedAccountId}</span>
            </p>
          )}
          {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Payments" description="Connect a Razorpay account so customers can pay you directly at checkout." />
      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
        <Card className="flex flex-col gap-5">
          <Field label="Business email" htmlFor="pa-email">
            <Input id="pa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Business phone" htmlFor="pa-phone">
            <Input id="pa-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+91 98765 43210" />
          </Field>
          <Field label="Legal business name" htmlFor="pa-legal-name">
            <Input id="pa-legal-name" value={legalBusinessName} onChange={(e) => setLegalBusinessName(e.target.value)} required />
          </Field>
          <Field label="Business type" htmlFor="pa-business-type">
            <Select id="pa-business-type" value={businessType} onChange={(e) => setBusinessType(e.target.value)} options={BUSINESS_TYPE_OPTIONS} />
          </Field>
          <Field label="Contact name" htmlFor="pa-contact-name">
            <Input id="pa-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} required />
          </Field>
          <Field label="Category" htmlFor="pa-category">
            <Select id="pa-category" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} />
          </Field>
          <Field label="Subcategory" htmlFor="pa-subcategory" hint="E.g. ecommerce_marketplace, fashion_and_lifestyle, electronics_and_furniture.">
            <Input id="pa-subcategory" value={subcategory} onChange={(e) => setSubcategory(e.target.value)} required />
          </Field>
          <Field label="PAN" htmlFor="pa-pan" hint="Optional, but usually required before Razorpay activates the account.">
            <Input id="pa-pan" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} />
          </Field>
          <Field label="GST" htmlFor="pa-gst" hint="Optional.">
            <Input id="pa-gst" value={gst} onChange={(e) => setGst(e.target.value.toUpperCase())} />
          </Field>
        </Card>

        <Card className="flex flex-col gap-5">
          <h2 className="text-sm font-semibold">Registered address</h2>
          <Field label="Address line 1" htmlFor="pa-street1">
            <Input id="pa-street1" value={street1} onChange={(e) => setStreet1(e.target.value)} required />
          </Field>
          <Field label="Address line 2" htmlFor="pa-street2">
            <Input id="pa-street2" value={street2} onChange={(e) => setStreet2(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="City" htmlFor="pa-city">
              <Input id="pa-city" value={city} onChange={(e) => setCity(e.target.value)} required />
            </Field>
            <Field label="State" htmlFor="pa-state">
              <Input id="pa-state" value={state} onChange={(e) => setState(e.target.value)} required />
            </Field>
          </div>
          <Field label="Postal code" htmlFor="pa-postal-code">
            <Input id="pa-postal-code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} required />
          </Field>
        </Card>

        {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end">
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit for review"}
          </Button>
        </div>
      </form>
    </>
  );
}
