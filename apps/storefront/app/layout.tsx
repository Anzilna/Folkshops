import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { serverFetch } from "../lib/api";
import { HeaderAccount } from "./header-account";
import "./globals.css";

// Light-only by design (unlike merchant-admin/platform-admin, which follow
// the OS light/dark setting) — not wired to @folkshops/ui's ThemeScript/
// ThemeProvider.

async function loadStore(): Promise<{ name: string; slug: string }> {
  try {
    const res = await serverFetch("/storefront/store");
    if (res.ok) return res.json();
  } catch {
    /* core-api down — fall through to the placeholder name */
  }
  return { name: "Folkshops", slug: "" };
}

export async function generateMetadata(): Promise<Metadata> {
  const store = await loadStore();
  return { title: store.name, description: `Shop ${store.name}` };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [store, cookieStore] = await Promise.all([loadStore(), cookies()]);
  const signedIn = cookieStore.has("fk_customer_access_token");

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="fk-material sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <Link href="/" className="text-base font-semibold tracking-tight">
              {store.name}
            </Link>
            <nav className="flex items-center gap-1">
              <Link href="/" className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Shop
              </Link>
              <HeaderAccount signedIn={signedIn} />
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-xs text-muted-foreground">
            <span>{store.name}</span>
            <span>Powered by Folkshops</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
