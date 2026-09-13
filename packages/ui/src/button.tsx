"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-accent-foreground hover:opacity-90",
  secondary: "bg-muted text-foreground hover:bg-border",
  outline: "border border-border text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * One Button, used everywhere (merchant-admin, platform-admin, and — once
 * built — storefront/marketing) instead of each app hand-rolling its own
 * button classes, so a hover/focus/disabled state fixed once is fixed
 * everywhere. Plain <button> underneath, not a styled div — keyboard/
 * screen-reader behavior comes for free.
 */
export function Button({ variant = "secondary", size = "md", className = "", disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
