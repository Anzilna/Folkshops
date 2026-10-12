import type { ReactNode } from "react";

/**
 * A bordered surface with NO built-in padding, for cards that lay out their
 * own header/body sections edge to edge. @folkshops/ui's Card always applies
 * p-6, and a `p-0` passed alongside it doesn't reliably win (both are the
 * same utility property; stylesheet order decides), which double-pads
 * anything that adds its own px-6. Forms keep using Card.
 */
export function Panel({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-background shadow-sm ${className}`}>{children}</div>;
}
