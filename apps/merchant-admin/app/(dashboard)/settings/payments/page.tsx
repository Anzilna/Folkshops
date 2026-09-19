"use client";

import { Button, Card, PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { formatDateTime } from "../../../../lib/format";
import { errorMessage, useTenantSlug } from "../../../../lib/hooks";

interface PaymentAccountRow {
  id: string;
  linkedAccountId: string | null;
  live: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  activatedAt: string | null;
}

export default function PaymentSettingsPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Payments" }]);
  const tenantSlug = useTenantSlug();
  const [account, setAccount] = useState<PaymentAccountRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (tenantSlug === null) return;
    apiFetch("/payment-accounts/me", {}, tenantSlug)
      .then((res) => (res.ok ? res.json() : null))
      .then(async (body: PaymentAccountRow | null) => {
        setAccount(body);
        // A merchant landing back here from Stripe's onboarding flow (or
        // whose link just expired) has no state in the URL to tell us
        // which — re-check status either way, same as clicking "Refresh
        // status" manually. See PaymentAccountsService.connect()'s
        // comment on why return_url/refresh_url both point here.
        if (body?.linkedAccountId && !body.live) {
          const refreshed = await apiFetch("/payment-accounts/refresh", { method: "POST" }, tenantSlug);
          if (refreshed.ok) setAccount(await refreshed.json());
        }
      })
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await apiFetch("/payment-accounts/connect", { method: "POST" }, tenantSlug);
      if (!res.ok) throw new Error(await errorMessage(res, "Couldn't start onboarding"));
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start onboarding");
      setConnecting(false);
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

  return (
    <>
      <PageHeader title="Payments" />

      <Card className="flex max-w-2xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Stripe</h2>
            <p className="max-w-md text-sm text-muted-foreground">Accept payments from your customers securely through Stripe.</p>
          </div>
          <StatusBadge account={account} />
        </div>

        {!account && (
          <div className="flex flex-col gap-2">
            <Button variant="primary" onClick={connect} disabled={connecting} className="w-fit">
              {connecting ? "Connecting..." : "Connect Stripe"}
            </Button>
            <p className="text-xs text-muted-foreground">Secure onboarding is handled by Stripe.</p>
          </div>
        )}

        {account && !account.live && (
          <div className="flex items-center justify-between gap-4">
            <p className="max-w-md text-sm text-muted-foreground">
              {account.detailsSubmitted
                ? "Stripe reviews every new account before it can accept live payments. This can take a moment — check back and refresh the status below."
                : "Onboarding hasn't been completed yet."}
            </p>
            <div className="flex shrink-0 gap-2">
              {!account.detailsSubmitted && (
                <Button variant="primary" onClick={connect} disabled={connecting}>
                  {connecting ? "Connecting..." : "Continue onboarding"}
                </Button>
              )}
              <Button variant="outline" onClick={refresh} disabled={refreshing}>
                {refreshing ? "Checking..." : "Refresh status"}
              </Button>
            </div>
          </div>
        )}

        {account?.live && (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            {account.linkedAccountId && (
              <p>
                Connected account: <span className="font-mono">{account.linkedAccountId}</span>
              </p>
            )}
            {account.activatedAt && <p>Connected {formatDateTime(account.activatedAt)}</p>}
            <Button variant="outline" onClick={refresh} disabled={refreshing} className="mt-2 w-fit">
              {refreshing ? "Checking..." : "Refresh status"}
            </Button>
          </div>
        )}

        {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </Card>
    </>
  );
}

function StatusBadge({ account }: { account: PaymentAccountRow | null }) {
  if (!account) return null;
  if (account.live) {
    return <span className="inline-flex w-fit rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">Connected</span>;
  }
  if (!account.detailsSubmitted) {
    return <span className="inline-flex w-fit rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">Onboarding in progress</span>;
  }
  return <span className="inline-flex w-fit rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">Pending review</span>;
}
