"use client";

import { Button, ConfirmDialog, Field, Modal, PageHeader, Textarea, useBreadcrumbs } from "@folkshops/ui";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AUDIT_ACTION_LABELS, auditDetail } from "../../../../lib/audit";
import { formatDate, formatDateTime, formatPrice } from "../../../../lib/format";
import { fetchTenantDetail, reactivateTenant, suspendTenant, type TenantDetail } from "../../../../lib/platform-api";
import { Panel } from "../../../panel";
import { StatusBadge, SubscriptionStatusBadge, TenantStatusBadge } from "../../../status";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel>
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      <div className="px-6 py-4">{children}</div>
    </Panel>
  );
}

export function TenantDetailView() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [suspending, setSuspending] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useBreadcrumbs([{ label: "Tenants", href: "/tenants" }, { label: detail?.tenant.name ?? "Store" }]);

  const load = useCallback(() => {
    fetchTenantDetail(id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this store"));
  }, [id]);

  useEffect(load, [load]);

  async function submitSuspend(e: React.FormEvent) {
    e.preventDefault();
    setSuspendError(null);
    setSuspending(true);
    try {
      await suspendTenant(id, reason.trim());
      setSuspendOpen(false);
      setReason("");
      load();
    } catch (err) {
      setSuspendError(err instanceof Error ? err.message : "Couldn't suspend this store");
    } finally {
      setSuspending(false);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!detail) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const { tenant, subscription, owners, usage, payments, history } = detail;
  const suspended = tenant.status === "suspended";

  return (
    <>
      <PageHeader
        title={tenant.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{tenant.slug}</span>
            <TenantStatusBadge status={tenant.status} />
            <span>· joined {formatDate(tenant.createdAt)}</span>
          </span>
        }
        actions={
          suspended ? (
            <Button variant="primary" onClick={() => setReactivateOpen(true)}>
              Reactivate store
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => setSuspendOpen(true)}>
              Suspend store
            </Button>
          )
        }
      />

      {actionError && (
        <p role="alert" className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {suspended && (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm" role="status">
          <p className="font-medium">This store is suspended{tenant.suspendedAt ? ` since ${formatDateTime(tenant.suspendedAt)}` : ""}.</p>
          <p className="mt-1 text-muted-foreground">
            Its storefront, merchant sign-in and AI assistant are all blocked. Internal reason: {tenant.suspensionReason ?? "—"}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Subscription">
          {subscription ? (
            <dl>
              <Row label="Plan">{subscription.planName}</Row>
              <Row label="Price">{subscription.priceCents === 0 ? "Free" : `${formatPrice(subscription.priceCents)} / month`}</Row>
              <Row label="Status">
                <SubscriptionStatusBadge status={subscription.status} />
              </Row>
              {subscription.currentPeriodEnd && <Row label="Current period ends">{formatDate(subscription.currentPeriodEnd)}</Row>}
              <Row label="Product limit">{subscription.maxProducts ?? "Unlimited"}</Row>
              <Row label="AI assistant">{subscription.aiAccess ? "Included" : "Not included"}</Row>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No subscription on record.</p>
          )}
        </Section>

        <Section title="Owners">
          {owners.length === 0 ? (
            <p className="text-sm text-muted-foreground">No owner on record.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {owners.map((o) => (
                <li key={o.id} className="text-sm">
                  <p className="font-medium">{o.name}</p>
                  <p className="text-muted-foreground">{o.email}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Usage">
          <dl>
            <Row label="Products">{usage.products}</Row>
            <Row label="Customers">{usage.customers}</Row>
            <Row label="Orders">{usage.orders}</Row>
            <Row label="Paid orders">{usage.paidOrders}</Row>
            <Row label="Paid revenue">{formatPrice(usage.paidRevenueCents)}</Row>
          </dl>
        </Section>

        <Section title="Payments">
          {payments ? (
            <dl>
              <Row label="Stripe account">
                {payments.live ? <StatusBadge tone="good">Live</StatusBadge> : <StatusBadge tone="warning">{payments.detailsSubmitted ? "Under review" : "Setup incomplete"}</StatusBadge>}
              </Row>
              <Row label="Payouts">{payments.payoutsEnabled ? "Enabled" : "Not enabled"}</Row>
              {payments.activatedAt && <Row label="Activated">{formatDate(payments.activatedAt)}</Row>}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Hasn&apos;t started connecting payments.</p>
          )}
        </Section>
      </div>

      <div className="mt-4">
        <Section title="History">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No admin actions on this store yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{AUDIT_ACTION_LABELS[h.action] ?? h.action}</span>
                    <span className="text-muted-foreground"> · {h.adminEmail}</span>
                    {auditDetail(h) && <span className="block text-xs text-muted-foreground">{auditDetail(h)}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Modal
        open={suspendOpen}
        onClose={() => !suspending && setSuspendOpen(false)}
        title={`Suspend ${tenant.name}?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setSuspendOpen(false)} disabled={suspending}>
              Cancel
            </Button>
            <Button variant="destructive" type="submit" form="suspend-form" disabled={suspending || reason.trim().length < 3}>
              {suspending ? "Suspending..." : "Suspend store"}
            </Button>
          </>
        }
      >
        <form id="suspend-form" onSubmit={submitSuspend} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            The storefront goes offline, the owner and staff are signed out and can&apos;t sign back in, and the AI assistant stops. Nothing is deleted — you can reactivate it at any time.
          </p>
          <Field label="Reason" htmlFor="suspend-reason" hint="Internal note for the team — the merchant never sees it. Recorded in the audit log.">
            <Textarea id="suspend-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required autoFocus />
          </Field>
          {suspendError && <p className="text-sm text-destructive">{suspendError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={reactivateOpen}
        onClose={() => setReactivateOpen(false)}
        onConfirm={async () => {
          // Errors are shown on the page, not thrown: ConfirmDialog closes
          // itself when onConfirm returns and has nowhere to show a failure.
          try {
            await reactivateTenant(id);
            setActionError(null);
          } catch (err) {
            setActionError(err instanceof Error ? err.message : "Couldn't reactivate this store");
          }
          load();
        }}
        title={`Reactivate ${tenant.name}?`}
        description="The storefront comes back online and the owner and staff can sign in again."
        confirmLabel="Reactivate"
        destructive={false}
      />
    </>
  );
}
