/**
 * Email-safe copies of packages/ui's theme.css light tokens. Duplicated as
 * plain hex rather than imported because email clients don't support CSS
 * variables at all (Gmail strips them) — every color must be inlined as a
 * literal. Keep these in step with theme.css's `:root` block by hand.
 */
export const colors = {
  background: "#ffffff",
  canvas: "#f5f5f5", // --muted, used as the page behind the card
  foreground: "#0a0a0a",
  border: "#e5e5e5",
  mutedForeground: "#737373",
  accent: "#171717",
  accentForeground: "#ffffff",
  success: "#16a34a",
} as const;

export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Same AED-first formatting as merchant-admin's lib/format.ts, but taking the currency from the payload rather than assuming it. */
export function formatMoney(cents: number, currency = "aed"): string {
  return new Intl.NumberFormat("en-AE", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
