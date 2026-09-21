const ANALYTICS_URL = process.env.NEXT_PUBLIC_ANALYTICS_URL ?? "http://localhost:4100";

/**
 * apps/analytics is a separate service from core-api (docs/decisions/0009)
 * — called directly cross-origin with credentials, same pattern lib/api.ts
 * already uses for core-api itself (not a same-origin rewrite proxy; that
 * pattern exists in the storefront for a different problem — cross-
 * SUBDOMAIN cookies — which doesn't apply here). No X-Tenant-Id header:
 * apps/analytics resolves tenant solely from the staff JWT cookie's own
 * tenantId claim, ignoring any header.
 */
export async function analyticsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${ANALYTICS_URL}${path}`, { ...init, credentials: "include" });
}

export interface DateRange {
  from: string;
  to: string;
}

export interface RevenueSummary {
  totalRevenueCents: number;
  orderCount: number;
  unitsSold: number;
}

export interface SalesOverTimePoint {
  date: string;
  orderCount: number;
  revenueCents: number;
  unitsSold: number;
}

export interface TopProduct {
  productId: string;
  productName: string;
  revenueCents: number;
  unitsSold: number;
  orderLineCount: number;
}

function rangeQuery(range?: DateRange, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ ...(range ? { from: range.from, to: range.to } : {}), ...extra });
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchRevenue(range?: DateRange): Promise<RevenueSummary> {
  const res = await analyticsFetch(`/analytics/revenue${rangeQuery(range)}`);
  if (!res.ok) throw new Error(`Failed to load revenue (${res.status})`);
  return res.json();
}

export async function fetchSalesOverTime(range?: DateRange): Promise<SalesOverTimePoint[]> {
  const res = await analyticsFetch(`/analytics/sales-over-time${rangeQuery(range, { interval: "day" })}`);
  if (!res.ok) throw new Error(`Failed to load sales-over-time (${res.status})`);
  return res.json();
}

export async function fetchTopProducts(range?: DateRange): Promise<TopProduct[]> {
  const res = await analyticsFetch(`/analytics/top-products${rangeQuery(range)}`);
  if (!res.ok) throw new Error(`Failed to load top-products (${res.status})`);
  return res.json();
}

/** EventSource has no fetch-style wrapper — withCredentials:true is its
 * own equivalent of credentials:"include", subject to the same CORS rules
 * (analytics' main.ts enableCors({credentials:true}) + an explicit,
 * non-wildcard origin, never "*"). */
export function subscribeRealtime(onEvent: (data: { eventType: string; aggregateId: string; occurredAt: string }) => void): () => void {
  const source = new EventSource(`${ANALYTICS_URL}/analytics/realtime/stream`, { withCredentials: true });
  source.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      // malformed event — ignore
    }
  };
  return () => source.close();
}

export type PeriodPreset = "7d" | "30d" | "90d";

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

/** The current window and an equal-length preceding window, back to back —
 * "previous period" always means "the same number of days right before
 * this one", the same comparison Shopify/most commerce dashboards use. */
export function periodRanges(preset: PeriodPreset, now: Date = new Date()): { current: DateRange; previous: DateRange } {
  const days = { "7d": 7, "30d": 30, "90d": 90 }[preset];
  const to = now;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const previousTo = from;
  const previousFrom = new Date(previousTo.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    current: { from: from.toISOString(), to: to.toISOString() },
    previous: { from: previousFrom.toISOString(), to: previousTo.toISOString() },
  };
}

export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null; // null = "new" (no prior baseline), not a real percentage
  return ((current - previous) / previous) * 100;
}
