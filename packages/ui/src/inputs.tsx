"use client";

import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const FIELD_CLASSES =
  "h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_CLASSES} w-full ${className}`} {...props} />;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOption[];
  /** Rendered as the first, valueless option — e.g. "All statuses". */
  placeholder?: string;
}

export function Select({ options, placeholder, className = "", ...props }: SelectProps) {
  return (
    <select className={`${FIELD_CLASSES} pr-8 ${className}`} {...props}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 rounded border-border text-accent focus:outline-none focus:ring-2 focus:ring-accent/40 ${className}`}
      {...props}
    />
  );
}

export function Label({ className = "", children, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { children?: ReactNode }) {
  return (
    <label className={`text-xs font-medium text-muted-foreground ${className}`} {...props}>
      {children}
    </label>
  );
}
