import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { serverFetch } from "../lib/api";
import { HeaderAccount } from "./header-account";
import { StoreNotFound } from "./store-not-found";
import "./globals.css";

// Light-only by design (unlike merchant-admin/platform-admin, which follow
// the OS light/dark setting) — not wired to @folkshops/ui's ThemeScript/
// ThemeProvider.

// null means no tenant resolved for this hostname (bare/apex domain,
// unrecognized subdomain, or core-api unreachable) — distinct from a real
// store, so callers must render StoreNotFound instead of falling back to
// placeholder branding. See lib/api.ts's resolveStoreSlug for why a bare
// hostname only ever resolves to a store outside production.
async function loadStore(): Promise<{ name: string; slug: string } | null> {
  try {
    const res = await serverFetch("/storefront/store");
    if (res.ok) return res.json();
  } catch {
    /* core-api down */
  }
  return null;
}

export async function generateMetadata(): Promise<Metadata> {
  const store = await loadStore();
  if (!store) return { title: "Store not found — Folkshops" };
  return { title: store.name, description: `Shop ${store.name}` };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [store, cookieStore] = await Promise.all([loadStore(), cookies()]);

  if (!store) {
    return (
      <html lang="en">
        <body className="min-h-screen">
          <StoreNotFound />
        </body>
      </html>
    );
  }

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
