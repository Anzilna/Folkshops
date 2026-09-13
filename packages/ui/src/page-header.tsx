"use client";

import type { ReactNode } from "react";

/** Title row every admin page starts with — title/description on the
 * left, primary actions on the right — so the list, new, and edit pages
 * of every resource line up identically. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A bordered surface for forms and detail views. */
export function Card({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-background p-6 shadow-sm ${className}`}>{children}</div>;
}
