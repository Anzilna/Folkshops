import type { ReactNode } from "react";

/**
 * Status colors are reserved for state, fixed (never themed), and never
 * carry meaning alone — every use pairs the color with an icon AND a label
 * (dataviz skill's status palette: good / warning / critical, plus a
 * neutral for "not started yet"). The text itself stays in the normal text
 * color; only the small icon is colored.
 */
export const STATUS_COLORS = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
  neutral: "var(--muted-foreground)",
} as const;

export type StatusTone = keyof typeof STATUS_COLORS;

const ICON_PATHS: Record<StatusTone, string> = {
  good: "M9 12.5l2 2 4-4.5M12 21a9 9 0 100-18 9 9 0 000 18z",
  warning: "M12 8v5M12 16.5h.01M10.3 4.2L2.8 17.5A2 2 0 004.5 20.5h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z",
  critical: "M9 9l6 6M15 9l-6 6M12 21a9 9 0 100-18 9 9 0 000 18z",
  neutral: "M12 7.5V12l3 2M12 21a9 9 0 100-18 9 9 0 000 18z",
};

export function StatusIcon({ tone, size = 14 }: { tone: StatusTone; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ color: STATUS_COLORS[tone] }} className="shrink-0">
      <path d={ICON_PATHS[tone]} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground">
      <StatusIcon tone={tone} size={12} />
      {children}
    </span>
  );
}

export const TENANT_STATUS: Record<"active" | "suspended", { tone: StatusTone; label: string }> = {
  active: { tone: "good", label: "Active" },
  suspended: { tone: "critical", label: "Suspended" },
};

export const SUBSCRIPTION_STATUS: Record<"incomplete" | "active" | "past_due" | "canceled", { tone: StatusTone; label: string }> = {
  active: { tone: "good", label: "Active" },
  past_due: { tone: "warning", label: "Past due" },
  canceled: { tone: "critical", label: "Canceled" },
  incomplete: { tone: "neutral", label: "Incomplete" },
};

export function TenantStatusBadge({ status }: { status: "active" | "suspended" }) {
  const s = TENANT_STATUS[status];
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

export function SubscriptionStatusBadge({ status }: { status: keyof typeof SUBSCRIPTION_STATUS }) {
  const s = SUBSCRIPTION_STATUS[status];
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}
