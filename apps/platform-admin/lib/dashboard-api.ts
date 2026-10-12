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
 * Same EventSource pattern as merchant-admin's analytics dashboard
 * (lib/analytics-api.ts's subscribeRealtime) — a thin "something changed"
 * signal over SSE, the dashboard re-fetches the real summary on receiving
 * one. withCredentials:true is EventSource's own equivalent of
 * credentials:"include", subject to the same CORS rules
 * (main.ts's enableCors({credentials:true}) with an explicit, non-wildcard
 * origin).
 */
export function subscribeDashboardRealtime(onEvent: () => void): () => void {
  const source = new EventSource(`${API_URL}/platform-admin/dashboard/stream`, { withCredentials: true });
  source.onmessage = () => onEvent();
  return () => source.close();
}
