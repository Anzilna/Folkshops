import type { Metadata } from "next";
import "./globals.css";

// Light-only by design (unlike merchant-admin/platform-admin, which follow
// the OS light/dark setting) — not wired to @folkshops/ui's ThemeScript/
// ThemeProvider.
export const metadata: Metadata = {
  title: "Folkshops",
  description: "Tenant storefront",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
