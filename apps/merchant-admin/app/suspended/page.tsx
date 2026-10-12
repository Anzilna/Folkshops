import { SuspendedActions } from "./suspended-actions";

export default function SuspendedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <h1 className="text-xl font-semibold">This store is suspended</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Access to this store has been paused by Folkshops, so its storefront is offline and the dashboard is unavailable. Nothing has been deleted. Please contact Folkshops support to find out more.
      </p>
      <SuspendedActions />
    </main>
  );
}
