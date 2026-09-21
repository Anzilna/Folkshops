"use client";

import { Button, Card } from "@folkshops/ui";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchRevenue,
  fetchSalesOverTime,
  fetchTopProducts,
  percentDelta,
  periodRanges,
  subscribeRealtime,
  PERIOD_LABELS,
  type PeriodPreset,
  type RevenueSummary,
  type SalesOverTimePoint,
  type TopProduct,
} from "../../lib/analytics-api";
import { formatCompactPrice, formatDate, formatPrice } from "../../lib/format";

const ICONS = {
  revenue: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  orders: "M6 3h12l1 5H5l1-5zM5 8h14l-1.2 11.2A2 2 0 0115.8 21H8.2a2 2 0 01-2-1.8L5 8zM9 12h6",
  avg: "M3 3v18h18M7 15l4-6 3 3 5-8",
  units: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
};

const SERIES_COLORS = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
  "var(--chart-series-5)",
];

/** Decorative diagonal-hatch fill for the ranked-bar chart, one per series
 * hue — background is the series color, hairlines a translucent surface
 * tone at 45° (dataviz skill's own texture spec: "inked tone-on-tone...
 * used at 45deg and its 135deg mirror"; normally an accessibility opt-in,
 * used here decoratively by explicit request). Defined once, referenced
 * by every Cell via fill="url(#...)". */
function HatchDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {SERIES_COLORS.map((color, i) => (
          <pattern key={i} id={`fk-hatch-${i}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={color} />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--background)" strokeOpacity="0.35" strokeWidth="2.5" />
          </pattern>
        ))}
      </defs>
    </svg>
  );
}

function StatIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">New</span>;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-success" : "text-destructive"}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
        {up ? <path d="M5 1l4 6H1z" /> : <path d="M5 9L1 3h8z" />}
      </svg>
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/** One tile inside the unified stat row — dividers between tiles carry the
 * separation (border-l), not individual card borders, matching a single
 * "at a glance" strip rather than four separate cards. */
function StatTile({ icon, label, value, delta, hero }: { icon: string; label: string; value: string; delta: number | null; hero?: boolean }) {
  return (
    <div className="flex flex-1 flex-col gap-2 px-6 py-5 first:pl-0 last:pr-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        <StatIcon d={icon} />
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <p className={hero ? "text-3xl font-semibold tracking-tight" : "text-2xl font-semibold tracking-tight"}>{value}</p>
        <DeltaBadge value={delta} />
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter = formatPrice,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-sm">
      {label && <p className="mb-1 text-muted-foreground">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 font-medium tabular-nums">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
          {valueFormatter(p.value)}
        </p>
      ))}
    </div>
  );
}

function displayName(email: string): string {
  if (!email) return "there";
  const local = email.split("@")[0];
  const first = local.split(/[.+_-]/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

const PRESETS: PeriodPreset[] = ["7d", "30d", "90d"];

export function DashboardAnalytics({ email }: { email: string }) {
  const [preset, setPreset] = useState<PeriodPreset>("30d");
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [prevRevenue, setPrevRevenue] = useState<RevenueSummary | null>(null);
  const [series, setSeries] = useState<{ dateLabel: string; current: number; previous: number; units: number; avgOrderCents: number }[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    const { current, previous } = periodRanges(preset);

    Promise.all([fetchRevenue(current), fetchRevenue(previous), fetchSalesOverTime(current), fetchSalesOverTime(previous), fetchTopProducts(current)])
      .then(([rev, prevRev, curSeries, prevSeries, products]: [RevenueSummary, RevenueSummary, SalesOverTimePoint[], SalesOverTimePoint[], TopProduct[]]) => {
        setRevenue(rev);
        setPrevRevenue(prevRev);
        const length = Math.max(curSeries.length, prevSeries.length);
        setSeries(
          Array.from({ length }, (_, i) => {
            const cur = curSeries[i];
            return {
              dateLabel: cur ? formatDate(cur.date) : "",
              current: cur?.revenueCents ?? 0,
              previous: prevSeries[i]?.revenueCents ?? 0,
              units: cur?.unitsSold ?? 0,
              avgOrderCents: cur && cur.orderCount > 0 ? Math.round(cur.revenueCents / cur.orderCount) : 0,
            };
          }),
        );
        setTopProducts(products.slice(0, 5));
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load analytics"));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  useEffect(() => {
    const unsubscribe = subscribeRealtime(() => {
      setLive(true);
      reload();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avgOrderCents = revenue && revenue.orderCount > 0 ? Math.round(revenue.totalRevenueCents / revenue.orderCount) : 0;
  const prevAvgOrderCents = prevRevenue && prevRevenue.orderCount > 0 ? Math.round(prevRevenue.totalRevenueCents / prevRevenue.orderCount) : 0;

  const daysWithOrders = series.filter((p) => p.avgOrderCents > 0);
  const avgOrderValueLine = daysWithOrders.length > 0 ? Math.round(daysWithOrders.reduce((s, p) => s + p.avgOrderCents, 0) / daysWithOrders.length) : 0;

  const today = useMemo(() => new Date().toLocaleDateString("en-AE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), []);

  return (
    <div className="flex flex-col gap-6">
      <HatchDefs />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Hey, {displayName(email)}</h2>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          {live && (
            <span className="fk-fade-in flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Live
            </span>
          )}
          <div className="flex gap-1 rounded-lg border border-border p-1">
            {PRESETS.map((p) => (
              <Button key={p} size="sm" variant={p === preset ? "primary" : "ghost"} onClick={() => setPreset(p)}>
                {PERIOD_LABELS[p].replace("Last ", "")}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* One unified strip, dividers not card borders — four numbers at a
       * glance, same shape as a typical commerce-dashboard header row. */}
      <Card className="fk-pop flex flex-wrap divide-x divide-border p-0 px-6" style={{ animationDelay: "0ms" }}>
        <StatTile
          icon={ICONS.revenue}
          label="Revenue"
          value={revenue ? formatCompactPrice(revenue.totalRevenueCents) : "—"}
          delta={revenue && prevRevenue ? percentDelta(revenue.totalRevenueCents, prevRevenue.totalRevenueCents) : null}
          hero
        />
        <StatTile
          icon={ICONS.orders}
          label="Orders"
          value={revenue ? String(revenue.orderCount) : "—"}
          delta={revenue && prevRevenue ? percentDelta(revenue.orderCount, prevRevenue.orderCount) : null}
        />
        <StatTile
          icon={ICONS.units}
          label="Units sold"
          value={revenue ? String(revenue.unitsSold) : "—"}
          delta={revenue && prevRevenue ? percentDelta(revenue.unitsSold, prevRevenue.unitsSold) : null}
        />
        <StatTile
          icon={ICONS.avg}
          label="Avg. order value"
          value={revenue ? formatPrice(avgOrderCents) : "—"}
          delta={revenue && prevRevenue ? percentDelta(avgOrderCents, prevAvgOrderCents) : null}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="fk-fade-in p-0" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h3 className="text-sm font-medium">Revenue</h3>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: "var(--chart-data)" }} />
                This period
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full border-t border-dashed border-muted-foreground" />
                Previous period
              </span>
            </div>
          </div>
          <div className="px-2 py-4">
            {series.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No paid orders yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="dateLabel" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tickFormatter={(v) => formatCompactPrice(v)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} width={64} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
                  <Area
                    type="monotone"
                    dataKey="previous"
                    name="Previous period"
                    stroke="var(--muted-foreground)"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    fill="none"
                    dot={false}
                    activeDot={{ r: 4, fill: "var(--muted-foreground)", stroke: "var(--background)", strokeWidth: 2 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="current"
                    name="This period"
                    stroke="var(--chart-data)"
                    strokeWidth={2}
                    fill="var(--chart-data)"
                    fillOpacity={0.1}
                    dot={false}
                    activeDot={{ r: 5, fill: "var(--chart-data)", stroke: "var(--background)", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="fk-fade-in p-0" style={{ animationDelay: "160ms" }}>
          <div className="border-b border-border px-6 py-4">
            <h3 className="text-sm font-medium">Top products</h3>
          </div>
          <div className="px-2 py-4">
            {topProducts.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No paid orders yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, topProducts.length * 48)}>
                <BarChart data={topProducts} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }} barSize={18}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="productName" tick={{ fill: "var(--foreground)", fontSize: 12 }} tickLine={false} axisLine={false} width={110} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v} sold`} />} cursor={{ fill: "var(--muted)" }} />
                  <Bar dataKey="unitsSold" radius={[0, 4, 4, 0]}>
                    {topProducts.map((product, i) => (
                      <Cell key={product.productId} fill={`url(#fk-hatch-${i % SERIES_COLORS.length})`} />
                    ))}
                    <LabelList dataKey="unitsSold" position="right" formatter={(v: unknown) => `${v} sold`} fill="var(--muted-foreground)" fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="fk-fade-in p-0" style={{ animationDelay: "200ms" }}>
          <div className="border-b border-border px-6 py-4">
            <h3 className="text-sm font-medium">Units sold</h3>
          </div>
          <div className="px-2 py-4">
            {series.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No paid orders yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barSize={16}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="dateLabel" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v} units`} />} cursor={{ fill: "var(--muted)" }} />
                  <Bar dataKey="units" name="Units sold" fill="var(--chart-data)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="fk-fade-in p-0" style={{ animationDelay: "240ms" }}>
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h3 className="text-sm font-medium">Avg. order value</h3>
            {avgOrderValueLine > 0 && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Avg {formatPrice(avgOrderValueLine)}</span>
            )}
          </div>
          <div className="px-2 py-4">
            {series.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No paid orders yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barSize={16}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="dateLabel" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tickFormatter={(v) => formatCompactPrice(v)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} width={56} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
                  {avgOrderValueLine > 0 && <ReferenceLine y={avgOrderValueLine} stroke="var(--foreground)" strokeDasharray="3 3" strokeOpacity={0.4} />}
                  <Bar dataKey="avgOrderCents" name="Avg. order value" fill="var(--chart-series-2)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
