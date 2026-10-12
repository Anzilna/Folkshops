"use client";

import { PageHeader } from "@folkshops/ui";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fetchDashboardSummary, subscribeDashboardRealtime, type PlatformDashboardSummary } from "../../lib/dashboard-api";
import { formatCompactPrice, formatDate } from "../../lib/format";
import { Panel } from "../panel";
import { STATUS_COLORS, StatusIcon, SUBSCRIPTION_STATUS, TenantStatusBadge, type StatusTone } from "../status";

const ICONS = {
  mrr: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  stores: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1",
  active: "M2 7h20v10H2V7zM2 11h20M6 15h3",
  attention: "M12 8v5M12 16.5h.01M10.3 4.2L2.8 17.5A2 2 0 004.5 20.5h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z",
};

// Ordered tiers, cheapest first — the order the plans page and a merchant's
// upgrade path use. A plan this list doesn't know sorts after, alphabetically.
const PLAN_ORDER = ["free", "basic", "standard", "advanced"];

// Segment order for the subscription stacked bar: healthy first, trouble last.
const STATUS_ORDER = ["active", "past_due", "incomplete", "canceled"] as const;

function planRank(slug: string): number {
  const i = PLAN_ORDER.indexOf(slug);
  return i === -1 ? PLAN_ORDER.length : i;
}

function StatTile({ icon, label, value, note, hero, tone }: { icon: string; label: string; value: string; note: ReactNode; hero?: boolean; tone?: StatusTone }) {
  return (
    // The hero tile is wider so its longer label stays on one line and every
    // tile's figure sits on the same baseline.
    <div className={`flex flex-col gap-2 px-6 py-5 first:pl-0 last:pr-0 ${hero ? "flex-[1.5]" : "flex-1"}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d={icon} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm">{label}</span>
      </div>
      {/* Proportional figures on purpose: tabular-nums makes a big standalone number look loose. */}
      <p className={hero ? "text-5xl font-semibold leading-none tracking-tight" : "text-2xl font-semibold tracking-tight"}>{value}</p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {tone && <StatusIcon tone={tone} size={12} />}
        {note}
      </p>
    </div>
  );
}

/** Appears on hover AND keyboard focus of its group, so the value is never mouse-only. */
function Tooltip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute -top-8 left-[7.25rem] z-10 whitespace-nowrap rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-sm transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

function PlanBars({ rows }: { rows: PlatformDashboardSummary["subscriptionsByPlan"] }) {
  const sorted = [...rows].sort((a, b) => planRank(a.planSlug) - planRank(b.planSlug) || a.planName.localeCompare(b.planName));
  const total = sorted.reduce((sum, r) => sum + r.count, 0);
  const max = Math.max(1, ...sorted.map((r) => r.count));

  if (sorted.length === 0) return <p className="py-6 text-sm text-muted-foreground">No subscriptions yet.</p>;

  return (
    <>
      <ul className="flex flex-col gap-1" aria-label="Stores per plan">
        {sorted.map((r) => (
          <li key={r.planSlug}>
            <div tabIndex={0} className="group relative grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3 rounded-md py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <span className="truncate text-sm">{r.planName}</span>
              {/* One series, one color for every bar: the length already says "more", so no ramp. */}
              <span className="flex h-6 items-center border-l border-border">
                <span
                  className="block h-3 rounded-r-[4px] transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.max((r.count / max) * 100, 2)}%`, backgroundColor: "var(--chart-series-1)" }}
                />
              </span>
              <span className="text-right text-sm font-medium tabular-nums">{r.count}</span>
              <Tooltip>
                {r.planName} · {r.count} {r.count === 1 ? "store" : "stores"} · {Math.round((r.count / total) * 100)}%
              </Tooltip>
            </div>
          </li>
        ))}
      </ul>
      {/* Screen-reader twin of the chart. */}
      <table className="sr-only">
        <caption>Stores per plan</caption>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Stores</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.planSlug}>
              <td>{r.planName}</td>
              <td>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function SubscriptionHealth({ counts }: { counts: PlatformDashboardSummary["subscriptionsByStatus"] }) {
  const total = STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0);
  if (total === 0) return <p className="py-6 text-sm text-muted-foreground">No subscriptions yet.</p>;

  return (
    <div className="flex flex-col gap-5">
      {/* 2px surface gap between segments, 4px rounded outer ends; empty states draw nothing. */}
      <div className="flex h-3 gap-0.5" role="img" aria-label={`Subscription status: ${STATUS_ORDER.map((s) => `${counts[s]} ${SUBSCRIPTION_STATUS[s].label.toLowerCase()}`).join(", ")}`}>
        {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
          <span
            key={s}
            className="first:rounded-l-[4px] last:rounded-r-[4px]"
            style={{ flexGrow: counts[s], backgroundColor: STATUS_COLORS[SUBSCRIPTION_STATUS[s].tone], opacity: s === "incomplete" ? 0.45 : 1 }}
          />
        ))}
      </div>
      {/* The legend doubles as the visible data table: icon + label + count, so color is never the only cue. */}
      <ul className="flex flex-col gap-1">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-sm">
            <span className="flex items-center gap-2">
              <StatusIcon tone={SUBSCRIPTION_STATUS[s].tone} />
              {SUBSCRIPTION_STATUS[s].label}
            </span>
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="font-medium">{counts[s]}</span>
              <span className="w-9 text-right text-xs text-muted-foreground">{Math.round((counts[s] / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardOverview() {
  const [summary, setSummary] = useState<PlatformDashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    fetchDashboardSummary()
      .then((s) => {
        setSummary(s);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the dashboard"))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load();
    return subscribeDashboardRealtime(() => {
      setLive(true);
      load();
    });
  }, [load]);

  const activeSubs = summary?.subscriptionsByStatus.active ?? 0;
  const pastDue = summary?.subscriptionsByStatus.past_due ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform overview"
        description={new Date().toLocaleDateString("en-AE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          live && (
            <span className="fk-fade-in flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Live
            </span>
          )
        }
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* On refetch the previous numbers stay (dimmed) instead of flashing a skeleton. */}
      <div className={`flex flex-col gap-6 transition-opacity duration-150 ${refreshing && summary ? "opacity-70" : ""}`}>
        <Panel className="flex flex-wrap divide-x divide-border px-6">
          <StatTile
            hero
            icon={ICONS.mrr}
            label="Monthly recurring revenue"
            value={summary ? formatCompactPrice(summary.mrrCents) : "—"}
            note={summary ? `${activeSubs} paying ${activeSubs === 1 ? "store" : "stores"}` : " "}
          />
          <StatTile
            icon={ICONS.stores}
            label="Stores"
            value={summary ? String(summary.tenantCounts.total) : "—"}
            note={summary ? `${summary.tenantCounts.active} active · ${summary.tenantCounts.suspended} suspended` : " "}
          />
          <StatTile
            icon={ICONS.active}
            label="Active subscriptions"
            value={summary ? String(activeSubs) : "—"}
            note={summary ? `of ${Object.values(summary.subscriptionsByStatus).reduce((a, b) => a + b, 0)} total` : " "}
          />
          <StatTile
            icon={ICONS.attention}
            label="Past due"
            value={summary ? String(pastDue) : "—"}
            tone={pastDue > 0 ? "warning" : "good"}
            note={pastDue > 0 ? "Payment failed — follow up" : "All payments on track"}
          />
        </Panel>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel>
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-sm font-medium">Stores by plan</h2>
            </div>
            <div className="px-6 py-4">{summary && <PlanBars rows={summary.subscriptionsByPlan} />}</div>
          </Panel>

          <Panel>
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-sm font-medium">Subscription health</h2>
            </div>
            <div className="px-6 py-5">{summary && <SubscriptionHealth counts={summary.subscriptionsByStatus} />}</div>
          </Panel>
        </div>

        <Panel>
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-sm font-medium">Recently joined</h2>
            <Link href="/tenants" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              View all stores
            </Link>
          </div>
          {summary && summary.recentTenants.length === 0 && <p className="px-6 py-8 text-sm text-muted-foreground">No stores yet.</p>}
          <ul>
            {summary?.recentTenants.map((t) => (
              <li key={t.id} className="border-b border-border last:border-0">
                <Link href={`/tenants/${t.id}`} className="flex items-center gap-4 px-6 py-3 transition-colors duration-150 hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t.slug}</span>
                  </span>
                  <span className="hidden w-24 text-sm text-muted-foreground sm:block">{t.planName ?? "No plan"}</span>
                  <TenantStatusBadge status={t.status as "active" | "suspended"} />
                  <span className="w-20 text-right text-xs text-muted-foreground">{formatDate(t.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
