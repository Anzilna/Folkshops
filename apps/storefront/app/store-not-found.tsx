import { MARKETING_URL, MERCHANT_ADMIN_URL } from "../lib/urls";

// Rendered by the root layout itself (not a route's not-found.tsx) when no
// tenant resolves for the incoming hostname — a bare/apex domain, an
// unrecognized subdomain, or core-api being unreachable. Deliberately its
// own full page, not route-level not-found.tsx's "Back to shop": there is
// no shop to go back to here.
export function StoreNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="sf-display text-6xl font-semibold text-muted-foreground/30">404</span>
      <h1 className="text-xl font-semibold">No store at this address</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This link doesn&apos;t point to a store. Double-check the address, or find what you&apos;re looking for below.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <a
          href={MARKETING_URL}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Go to Folkshops
        </a>
        <a href={`${MERCHANT_ADMIN_URL}/login`} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Sign in to your store
        </a>
      </div>
    </div>
  );
}
