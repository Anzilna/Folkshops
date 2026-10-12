import { API_URL, apiFetch } from "./api";

export interface PlatformDashboardSummary {
  tenantCounts: { active: number; suspended: number; total: number };
  subscriptionsByStatus: Record<"incomplete" | "active" | "past_due" | "canceled", number>;
  subscriptionsByPlan: { planSlug: string; planName: string; count: number }[];
  mrrCents: number;
  recentTenants: { id: string; name: string; slug: string; status: string; createdAt: string; planName: string | null }[];
}

export async function fetchDashboardSummary(): Promise<PlatformDashboardSummary> {
  const res = await apiFetch("/platform-admin/dashboard");
  if (!res.ok) throw new Error(`Failed to load dashboard (${res.status})`);
  return res.json();
}

/**
 * One shared EventSource for the whole app, ref-counted across subscribers.
 * The dashboard page and the notification bell both want the same "something
 * changed" signal; two open connections for one browser tab would be
 * wasteful (and each one is a server-side Redis subscriber). The first
 * subscriber opens it, the last one out closes it.
 *
 * Same signal-only design as merchant-admin's analytics stream: it carries
 * no data, subscribers re-fetch the real thing on receiving it.
 * withCredentials:true is EventSource's equivalent of credentials:"include"
 * (core-api's enableCors({credentials:true}) with an explicit origin).
 */
const listeners = new Set<() => void>();
let source: EventSource | null = null;

export function subscribeDashboardRealtime(onEvent: () => void): () => void {
  listeners.add(onEvent);
  if (!source) {
    source = new EventSource(`${API_URL}/platform-admin/dashboard/stream`, { withCredentials: true });
    source.onmessage = () => listeners.forEach((fn) => fn());
  }
  return () => {
    listeners.delete(onEvent);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}
