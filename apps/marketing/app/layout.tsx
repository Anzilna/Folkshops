import type { Metadata } from "next";
import Link from "next/link";
import { MERCHANT_ADMIN_URL } from "../lib/urls";
import "./globals.css";

// Light-only by design (unlike merchant-admin/platform-admin, which follow
// the OS light/dark setting) — not wired to @folkshops/ui's ThemeScript/
// ThemeProvider, same permanent decision as storefront.
export const metadata: Metadata = {
  title: "Folkshops",
  description: "The UAE-first platform for launching and running an online store.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <header className="fk-material sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <span className="fk-brand-mark flex h-7 w-7 items-center justify-center rounded-lg text-sm font-semibold text-accent-foreground">F</span>
              Folkshops
            </Link>
            <nav className="flex items-center gap-1">
              <a href={`${MERCHANT_ADMIN_URL}/login`} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Sign in
              </a>
              <a
                href={`${MERCHANT_ADMIN_URL}/register`}
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
              >
                Start selling
              </a>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-6 py-8 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
            <span>&copy; {new Date().getFullYear()} Folkshops.</span>
            <span>Built for merchants in the UAE.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
