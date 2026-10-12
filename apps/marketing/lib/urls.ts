export const MERCHANT_ADMIN_URL = process.env.NEXT_PUBLIC_MERCHANT_ADMIN_URL ?? "http://localhost:3001";
export const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3000";

// Server-only (no NEXT_PUBLIC_ prefix) — the /pricing page fetches GET
// /plans in a Server Component, never from the browser, so this never
// needs to be in CORS_ORIGINS or reach client JS at all.
export const API_URL = process.env.API_URL ?? "http://localhost:4000";
