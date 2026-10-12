/** Fils -> "AED 1,499.00". Lives here, not in a page.tsx — Next.js only allows
 * page modules to export the page itself plus its config fields. */
export function formatPrice(cents: number): string {
  return `AED ${(cents / 100).toLocaleString("en-AE", { minimumFractionDigits: 2 })}`;
}

/** Fils -> "AED 706K" — compact form for a hero figure only; table cells use formatPrice. */
export function formatCompactPrice(cents: number): string {
  return `AED ${(cents / 100).toLocaleString("en-AE", { notation: "compact", maximumFractionDigits: 1 })}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AE");
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AE", { dateStyle: "medium", timeStyle: "short" });
}

/** "just now", "5m ago", "3h ago", "2d ago" — for "last sign-in" style cells. */
export function formatRelative(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
