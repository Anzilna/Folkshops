import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { serverFetch, type Order } from "../../../lib/api";
import { formatDate, formatPrice } from "../../../lib/format";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const [{ id }, { placed }, cookieStore] = await Promise.all([params, searchParams, cookies()]);
  const res = await serverFetch(`/storefront/orders/${id}`, cookieStore.toString());
  if (res.status === 401) redirect(`/login?next=/orders/${id}`);
  if (!res.ok) notFound();
  const order: Order = await res.json();
  const items = order.items ?? [];
  const units = items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      {placed && (
        <div className="fk-fade-in flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 px-5 py-4">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-medium">Order placed</p>
            <p className="text-sm text-muted-foreground">Thanks — we&apos;ve recorded it. Payment and delivery tracking are coming soon.</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Link href="/orders" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; All orders
        </Link>
        <h1 className="sf-display text-3xl font-semibold">Order #{id.slice(0, 8).toUpperCase()}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(order.createdAt)} &middot; <span className="capitalize">{order.status}</span>
        </p>
      </div>

      <div className="rounded-2xl border border-border">
        <div className="border-b border-border px-5 py-3 text-sm font-medium">
          {units} item{units === 1 ? "" : "s"}
        </div>
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{i.productName}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatPrice(i.priceCents)} &times; {i.quantity}
                </p>
              </div>
              <span className="tabular-nums">{formatPrice(i.priceCents * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border px-5 py-4 text-base font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(order.subtotalCents)}</span>
        </div>
      </div>
    </div>
  );
}
