export function formatPrice(cents: number): string {
  return `AED ${(cents / 100).toLocaleString("en-AE", { minimumFractionDigits: 2 })}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AE", { day: "numeric", month: "short", year: "numeric" });
}

/** Deterministic hue from a name — products have no images yet, so each
 * tile gets a stable, distinct tint instead of one grey box repeated. */
export function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}
