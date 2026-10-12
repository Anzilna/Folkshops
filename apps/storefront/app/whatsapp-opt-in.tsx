"use client";

import { Checkbox } from "@folkshops/ui";

/**
 * The one WhatsApp consent control, used at checkout and on /account. The
 * wording is the consent: Meta's opt-in policy requires telling people
 * they'll be messaged on WhatsApp, by whom, and about what — so keep
 * "WhatsApp", the store name, and the order-updates scope in the label.
 * Never pre-checked (see customers.ts's whatsappOptIn comment).
 */
export function WhatsAppOptIn({
  checked,
  onChange,
  storeName,
  phone,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  storeName?: string;
  phone?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-2.5 text-sm transition-colors hover:bg-muted/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <Checkbox className="mt-0.5 shrink-0 [accent-color:var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Get order updates on WhatsApp</span>
        <span className="text-xs text-muted-foreground">
          {storeName ?? "This store"} will message {phone ? <span className="tabular-nums">{phone}</span> : "your number"} about your orders. Turn this off anytime in your account.
        </span>
      </span>
    </label>
  );
}
