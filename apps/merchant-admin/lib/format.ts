/** Fils -> "AED 1,499.00". Lives here, not in a page.tsx — Next.js only allows
 * page modules to export the page itself plus its config fields. */
export function formatPrice(cents: number): string {
  return `AED ${(cents / 100).toLocaleString("en-AE", { minimumFractionDigits: 2 })}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AE");
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AE", { dateStyle: "medium", timeStyle: "short" });
}
