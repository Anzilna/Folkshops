"use client";

import { Button, Card, PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { errorMessage, useTenantSlug } from "../../../../lib/hooks";

interface Plan {
  slug: string;
  name: string;
  priceCents: number;
  currency: string;
  maxProducts: number | null;
}

interface Subscription {
  status: "incomplete" | "active" | "past_due" | "canceled";
  stripeCustomerId: string | null;
}

interface SubscriptionResponse {
  subscription: Subscription;
  plan: Plan;
}

function formatPlanPrice(plan: Plan): string {
  if (plan.priceCents === 0) return "Free";
  return `${plan.currency.toUpperCase()} ${(plan.priceCents / 100).toLocaleString("en-AE")}/mo`;
}

/** GET /subscriptions/me + POST /subscriptions/portal-session — see docs/decisions/0012. */
export default function BillingSettingsPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Billing" }]);
  const tenantSlug = useTenantSlug();
  const [data, setData] = useState<SubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    if (tenantSlug === null) return;
    apiFetch("/subscriptions/me", {}, tenantSlug)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  async function openPortal() {
    setManaging(true);
    setError(null);
    try {
      const res = await apiFetch("/subscriptions/portal-session", { method: "POST" }, tenantSlug);
      if (!res.ok) throw new Error(await errorMessage(res, "Couldn't open billing portal"));
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open billing portal");
      setManaging(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Billing" />
        <Card className="h-64 animate-pulse bg-muted/40" />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Billing" />
        <Card>
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your subscription.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Billing" />

      <Card className="flex max-w-2xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Current plan</h2>
            <p className="text-2xl font-semibold">{data.plan.name}</p>
            <p className="text-sm text-muted-foreground">{formatPlanPrice(data.plan)}</p>
          </div>
          <StatusBadge status={data.subscription.status} />
        </div>

        <p className="text-sm text-muted-foreground">
          {data.plan.maxProducts === null ? "Unlimited products" : `Up to ${data.plan.maxProducts} products`}
        </p>

        {data.subscription.stripeCustomerId && (
          <Button variant="outline" onClick={openPortal} disabled={managing} className="w-fit">
            {managing ? "Opening..." : "Manage billing"}
          </Button>
        )}

        {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </Card>
    </>
  );
}

function StatusBadge({ status }: { status: Subscription["status"] }) {
  if (status === "active") {
    return <span className="inline-flex w-fit rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">Active</span>;
  }
  if (status === "past_due") {
    return <span className="inline-flex w-fit rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive">Payment past due</span>;
  }
  if (status === "canceled") {
    return <span className="inline-flex w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Canceled</span>;
  }
  return <span className="inline-flex w-fit rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">Awaiting payment</span>;
}
