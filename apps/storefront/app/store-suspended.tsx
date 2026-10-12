import { MARKETING_URL } from "../lib/urls";

// Rendered by the root layout when core-api answers 403 store_suspended for
// this hostname — a platform admin paused the store. Distinct from
// StoreNotFound (the address is right; the store is just offline), and it
// deliberately says nothing about why: the reason is internal.
export function StoreSuspended({ storeName }: { storeName?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">{storeName ?? "This store"} is temporarily unavailable</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The shop is offline for now. Please check back later — your account and orders are safe.
      </p>
      <a
        href={MARKETING_URL}
        className="mt-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
      >
        Go to Folkshops
      </a>
    </div>
  );
}
