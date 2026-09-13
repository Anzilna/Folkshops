"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface Crumb {
  label: string;
  href?: string;
}

interface BreadcrumbContextValue {
  crumbs: Crumb[] | null;
  setCrumbs: (crumbs: Crumb[] | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

/** Mounted by AdminShell around both the top bar and the page, so a page
 * deep in the tree can publish crumbs the bar above it renders. */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[] | null>(null);
  return <BreadcrumbContext.Provider value={{ crumbs, setCrumbs }}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbContext(): BreadcrumbContextValue | null {
  return useContext(BreadcrumbContext);
}

/**
 * Called by a page: `useBreadcrumbs([{ label: "Products", href: "/products" }, { label: "Edit" }])`.
 * Cleared on unmount so a page that doesn't call it falls back to the
 * shell's default (brand / active nav label). Keyed on the serialized
 * crumbs so a label that arrives async (e.g. the product's name after
 * fetch) updates the bar without an effect-deps lint dance per page.
 */
export function useBreadcrumbs(crumbs: Crumb[]) {
  const ctx = useBreadcrumbContext();
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    if (!ctx) return;
    ctx.setCrumbs(JSON.parse(key) as Crumb[]);
    return () => ctx.setCrumbs(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function Breadcrumbs({
  crumbs,
  LinkComponent,
}: {
  crumbs: Crumb[];
  LinkComponent: React.ComponentType<{ href: string; className?: string; children: ReactNode }>;
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-muted-foreground/50">
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {crumb.href && !last ? (
              <LinkComponent
                href={crumb.href}
                className="truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {crumb.label}
              </LinkComponent>
            ) : (
              <span
                key={crumb.label}
                className={`fk-fade-in truncate ${last ? "font-medium text-foreground" : "text-muted-foreground"}`}
                aria-current={last ? "page" : undefined}
              >
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
