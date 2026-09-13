"use client";

import { ThemeToggle } from "@folkshops/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "./logout-button";

function icon(d: string) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: icon("M4 12l8-8 8 8M6 10v10h12V10") },
  { href: "/products", label: "Products", icon: icon("M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8") },
  { href: "/orders", label: "Orders", icon: icon("M6 3h12l1 5H5l1-5zM5 8h14l-1.2 11.2A2 2 0 0115.8 21H8.2a2 2 0 01-2-1.8L5 8zM9 12h6") },
  { href: "/categories", label: "Categories", icon: icon("M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5") },
  { href: "/inventory", label: "Inventory", icon: icon("M3 7h18v13H3V7zM3 7l2-4h14l2 4M9 11h6") },
  {
    href: "/customers",
    label: "Customers",
    icon: icon("M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19M9 11a3 3 0 100-6 3 3 0 000 6zM20 19v-1.5a3 3 0 00-2.5-2.96M15 4.1a3 3 0 010 5.8"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: icon(
      "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.14.42.75 1 1.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
    ),
  },
];

interface DashboardShellProps {
  tenantName: string;
  userEmail: string;
  children: ReactNode;
}

export function DashboardShell({ tenantName, userEmail, children }: DashboardShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border p-3">
        <div className="mb-6 flex items-center gap-2 px-2 pt-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-foreground">
            F
          </div>
          <span className="truncate text-sm font-semibold">{tenantName}</span>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {active && <span className="absolute -left-3 h-4 w-1 rounded-r-full bg-accent" />}
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
          <span className="text-sm text-muted-foreground">{userEmail}</span>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <span className="h-5 w-px bg-border" />
            <LogoutButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {/* Wider than the original max-w-4xl — the table pages
              (products/orders/inventory/customers) need the room, and the
              dashboard's onboarding cards still read fine at this width. */}
          <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
