"use client";

import type { ComponentType, ReactNode } from "react";
import { BreadcrumbProvider, Breadcrumbs, useBreadcrumbContext } from "./breadcrumbs";
import { ChatWidget } from "./chat-widget";
import { NotificationBell, type NotificationItem } from "./notifications";

export interface NavItem {
  href: string;
  label: string;
  /** SVG path `d` — rendered into a 24x24 stroke icon, same as the apps did inline before. */
  iconPath: string;
}

type LinkLike = ComponentType<{ href: string; className?: string; children: ReactNode }>;

export interface AdminShellProps {
  brand: string;
  brandMark?: string;
  navItems: NavItem[];
  /** Current path — passed in rather than read via next/navigation so this
   * package stays framework-agnostic (react is its only peer dep). */
  pathname: string;
  /** next/link, or any component with the same shape. Plain <a> would lose
   * client-side navigation, so the app hands its router's Link in. */
  LinkComponent: LinkLike;
  /** Shown in the account card at the bottom of the sidebar. */
  accountLabel: string;
  accountSublabel?: string;
  /** Rendered inside the account card — each app's own LogoutButton. */
  accountAction?: ReactNode;
  /** Right side of the top bar — ThemeToggle, etc. */
  headerRight?: ReactNode;
  /** Rendered as a bell in the top bar when provided. */
  notifications?: NotificationItem[];
  /** Mounts the floating chat preview (see chat-widget.tsx). */
  assistantName?: string;
  children: ReactNode;
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function initials(label: string): string {
  const base = label.includes("@") ? label.split("@")[0] : label;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)).toUpperCase();
}

/**
 * The one admin chrome (sidebar + top bar) both merchant-admin and
 * platform-admin render — they previously carried near-identical copies,
 * so any polish had to be done twice. Motion is plain CSS from theme.css
 * (fk-nav-in, fk-active-bar), no animation library, and every transition
 * collapses to nothing under prefers-reduced-motion.
 */
export function AdminShell(props: AdminShellProps) {
  return (
    <BreadcrumbProvider>
      <AdminShellInner {...props} />
    </BreadcrumbProvider>
  );
}

function AdminShellInner({
  brand,
  brandMark = "F",
  navItems,
  pathname,
  LinkComponent,
  accountLabel,
  accountSublabel,
  accountAction,
  headerRight,
  notifications,
  assistantName,
  children,
}: AdminShellProps) {
  const activeItem =
    navItems.find((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href))) ?? navItems[0];
  // Pages publish their own trail via useBreadcrumbs(); anything that
  // doesn't gets brand / active-nav-label so the bar is never empty.
  const published = useBreadcrumbContext()?.crumbs;
  const crumbs = [
    { label: brand, href: "/" },
    ...(published && published.length > 0 ? published : [{ label: activeItem.label }]),
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-border bg-muted/40 px-3 py-4">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="fk-brand-mark flex h-8 w-8 items-center justify-center rounded-xl text-sm font-semibold text-accent-foreground shadow-sm">
            {brandMark}
          </div>
          <span className="truncate text-sm font-semibold tracking-tight">{brand}</span>
        </div>

        <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">Menu</p>
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item, index) => {
            const active = item === activeItem;
            return (
              <LinkComponent
                key={item.href}
                href={item.href}
                className={`fk-nav-in group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all duration-200 ease-out ${
                  active
                    ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:translate-x-0.5 hover:bg-background/70 hover:text-foreground"
                }`}
              >
                <span
                  className={`fk-active-bar absolute -left-3 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r-full bg-accent ${
                    active ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0"
                  }`}
                  style={{ ["--fk-i" as string]: index } as never}
                />
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-200 ${
                    active ? "text-accent" : "text-muted-foreground group-hover:text-foreground"
                  }`}
                  style={{ ["--fk-i" as string]: index } as never}
                >
                  <NavIcon d={item.iconPath} />
                </span>
                {item.label}
              </LinkComponent>
            );
          })}
        </nav>

        <div className="mt-auto rounded-2xl border border-border bg-background p-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
              {initials(accountLabel)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{accountLabel}</p>
              {accountSublabel && <p className="truncate text-[11px] text-muted-foreground">{accountSublabel}</p>}
            </div>
          </div>
          {accountAction && <div className="mt-2.5">{accountAction}</div>}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-md">
          <Breadcrumbs crumbs={crumbs} LinkComponent={LinkComponent} />
          <div className="flex items-center gap-2">
            {notifications && <NotificationBell items={notifications} LinkComponent={LinkComponent} />}
            {headerRight}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div key={pathname} className="fk-fade-in mx-auto max-w-6xl px-6 py-8">
            {children}
          </div>
        </main>
      </div>

      {assistantName && <ChatWidget assistantName={assistantName} />}
    </div>
  );
}
