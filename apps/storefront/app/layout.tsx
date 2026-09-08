import type { Metadata } from "next";
import "./globals.css";

// Light-only for now, deliberately not wired to system/dark theming yet
// (unlike merchant-admin/platform-admin) — @folkshops/ui/css's tokens are
// still imported via globals.css, so enabling it later is just adding back
// <ThemeScript />/<ThemeProvider> here, no CSS changes needed.
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
