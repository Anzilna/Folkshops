"use client";

import { useEffect, useRef, useState } from "react";
import { usePresence } from "./use-presence";

export type NotificationKind = "order" | "stock" | "customer" | "system";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** ISO timestamp. */
  at: string;
  read?: boolean;
  href?: string;
}

/**
 * Placeholder data until real events exist (notifications are a Phase 2
 * item — outbox + BullMQ). Timestamps are relative to "now" so the list
 * never looks stale in a demo.
 */
export function demoNotifications(): NotificationItem[] {
  const m = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
  return [
    { id: "n1", kind: "order", title: "New order #4D9BD3E8", body: "Meera Khan placed an order for ₹54,745.00.", at: m(4), href: "/orders" },
    { id: "n2", kind: "stock", title: "Low stock", body: "Teal Khadi Card Wallet is out of stock.", at: m(38), href: "/inventory" },
    { id: "n3", kind: "customer", title: "New customer", body: "+91 98105 86006 signed up via OTP.", at: m(120), href: "/customers" },
    { id: "n4", kind: "order", title: "Order cancelled", body: "#B29DA3E6 was cancelled by the customer.", at: m(60 * 5), read: true, href: "/orders" },
    { id: "n5", kind: "system", title: "CSV import finished", body: "180 products imported, 0 failed.", at: m(60 * 26), read: true, href: "/products" },
  ];
}

function relative(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const KIND_STYLE: Record<NotificationKind, { icon: string; cls: string }> = {
  order: { icon: "M6 3h12l1 5H5l1-5zM5 8h14l-1.2 11.2A2 2 0 0115.8 21H8.2a2 2 0 01-2-1.8L5 8z", cls: "bg-accent/10 text-accent" },
  stock: { icon: "M3 7h18v13H3V7zM3 7l2-4h14l2 4M12 11v4M12 18h.01", cls: "bg-destructive/10 text-destructive" },
  customer: { icon: "M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19M9 11a3 3 0 100-6 3 3 0 000 6z", cls: "bg-success/15 text-success" },
  system: { icon: "M12 8v4l3 3M12 3a9 9 0 100 18 9 9 0 000-18z", cls: "bg-muted text-muted-foreground" },
};

export function NotificationBell({
  items: initial,
  LinkComponent,
  onMarkRead,
  onMarkAllRead,
}: {
  items: NotificationItem[];
  LinkComponent: React.ComponentType<{ href: string; className?: string; children: React.ReactNode; onClick?: () => void }>;
  /** Optional — when provided, read-state is persisted server-side (called
   * in addition to the local optimistic update below); when omitted, read
   * state is local-only, same as before (platform-admin, still on canned
   * `demoNotifications()`). */
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
}) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const { mounted, state } = usePresence(open, 120);
  const ref = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read).length;

  // `items` is fetched async by the caller (a real API call in
  // merchant-admin's case) and may arrive after this component's first
  // render — keep local state in sync whenever a fresh list comes in,
  // without clobbering an optimistic mark-as-read the user just clicked.
  useEffect(() => {
    setItems(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function markAllRead() {
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    onMarkAllRead?.();
  }
  function markRead(id: string) {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    onMarkRead?.(id);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.97]"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="fk-pop absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unread}
          </span>
        )}
      </button>

      {mounted && (
        // Origin is the bell it opens from (top-right), and it leaves the way
        // it came. 150ms in / 120ms out — dropdown budget is 150–250ms.
        <div
          data-state={state}
          className="fk-presence absolute right-0 top-11 z-30 w-[22rem] origin-top-right overflow-hidden rounded-2xl border border-border bg-background shadow-xl transition-[transform,opacity] duration-150 ease-out data-[state=closed]:-translate-y-1 data-[state=closed]:scale-[0.97] data-[state=closed]:opacity-0 data-[state=closed]:duration-[120ms]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs text-muted-foreground hover:text-foreground">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</li>}
            {items.map((n) => {
              const style = KIND_STYLE[n.kind];
              const inner = (
                <>
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.cls}`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d={style.icon} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${n.read ? "text-foreground" : "font-medium text-foreground"}`}>{n.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{relative(n.at)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                  </span>
                  {!n.read && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                </>
              );
              const cls = `flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/60 ${n.read ? "" : "bg-accent/[0.03]"}`;
              return (
                <li key={n.id} className="border-b border-border last:border-0">
                  {n.href ? (
                    <LinkComponent
                      href={n.href}
                      className={cls}
                      onClick={() => {
                        markRead(n.id);
                        setOpen(false);
                      }}
                    >
                      {inner}
                    </LinkComponent>
                  ) : (
                    <button type="button" className={cls} onClick={() => markRead(n.id)}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
