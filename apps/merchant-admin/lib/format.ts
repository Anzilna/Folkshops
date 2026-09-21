/** Fils -> "AED 1,499.00". Lives here, not in a page.tsx — Next.js only allows
 * page modules to export the page itself plus its config fields. */
export function formatPrice(cents: number): string {
  return `AED ${(cents / 100).toLocaleString("en-AE", { minimumFractionDigits: 2 })}`;
}

/** Fils -> "AED 706K" / "AED 4.2M" — auto-compact, for a hero stat-tile
 * figure only (dataviz skill: large standalone numbers use compact
 * proportional figures, never the full comma'd form — that's what
 * formatPrice's table-column form is for). */
export function formatCompactPrice(cents: number): string {
  return `AED ${(cents / 100).toLocaleString("en-AE", { notation: "compact", maximumFractionDigits: 1 })}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AE");
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AE", { dateStyle: "medium", timeStyle: "short" });
}
