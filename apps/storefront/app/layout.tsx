import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { serverFetch } from "../lib/api";
import { HeaderAccount } from "./header-account";
import { ShoppingAssistant } from "./shopping-assistant";
import { StoreNotFound } from "./store-not-found";
import { StoreSuspended } from "./store-suspended";
import "./globals.css";

// Light-only by design (unlike merchant-admin/platform-admin, which follow
// the OS light/dark setting) — not wired to @folkshops/ui's ThemeScript/
// ThemeProvider.

// null means no tenant resolved for this hostname (bare/apex domain,
// unrecognized subdomain, or core-api unreachable) — distinct from a real
// store, so callers must render StoreNotFound instead of falling back to
// placeholder branding. See lib/api.ts's resolveStoreSlug for why a bare
// hostname only ever resolves to a store outside production.
type Store = { name: string; slug: string; aiAssistantEnabled?: boolean };

// "suspended" is its own state, not "missing": core-api answers 403 with
// code store_suspended when a platform admin has paused the store.
type StoreState = { kind: "ok"; store: Store } | { kind: "suspended" } | { kind: "missing" };

async function loadStore(): Promise<StoreState> {
  try {
    const res = await serverFetch("/storefront/store");
    if (res.ok) return { kind: "ok", store: await res.json() };
    if (res.status === 403) {
      const body = await res.json().catch(() => null);
      if (body?.code === "store_suspended") return { kind: "suspended" };
    }
  } catch {
    /* core-api down */
  }
  return { kind: "missing" };
}

export async function generateMetadata(): Promise<Metadata> {
  const state = await loadStore();
  if (state.kind === "suspended") return { title: "Store unavailable — Folkshops" };
  if (state.kind !== "ok") return { title: "Store not found — Folkshops" };
  return { title: state.store.name, description: `Shop ${state.store.name}` };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [state, cookieStore] = await Promise.all([loadStore(), cookies()]);

  if (state.kind === "suspended") {
    return (
      <html lang="en">
        <body className="min-h-screen">
          <StoreSuspended />
        </body>
      </html>
    );
  }

  if (state.kind !== "ok") {
    return (
      <html lang="en">
        <body className="min-h-screen">
          <StoreNotFound />
        </body>
      </html>
    );
  }

  const store = state.store;
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

        {/* Only for stores whose plan includes AI — display only; ai-service checks the plan on every message. */}
        {store.aiAssistantEnabled && <ShoppingAssistant storeName={store.name} signedIn={signedIn} />}
      </body>
    </html>
  );
}
