import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverFetch, type Order } from "../../lib/api";
import { formatDate, formatPrice } from "../../lib/format";

export default async function OrdersPage() {
  const cookieHeader = (await cookies()).toString();
  const res = await serverFetch("/storefront/orders", cookieHeader);
  if (res.status === 401) redirect("/login?next=/orders");
  const orders: Order[] = res.ok ? await res.json() : [];
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <h1 className="sf-display text-3xl font-semibold">Your orders</h1>

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-20 text-center">
          <p className="text-sm text-muted-foreground">You haven&apos;t ordered anything yet.</p>
          <Link href="/" className="mt-3 inline-block text-sm underline underline-offset-4">
            Start shopping
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/50">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs font-medium uppercase">#{o.id.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${o.status === "pending" ? "bg-accent/10 text-accent" : "bg-destructive/10 text-destructive"}`}>{o.status}</span>
                  <span className="text-sm font-medium tabular-nums">{formatPrice(o.subtotalCents)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
