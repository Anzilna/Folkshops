"use client";

import { useEffect, type ReactNode } from "react";
import { usePresence } from "./use-presence";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * One modal, used for every confirm dialog — fix keyboard/overlay
 * behavior once. Motion: overlay fades, panel scales from 0.97 + opacity
 * (never from 0) with the strong ease-out; exit is faster than enter and
 * runs the same path in reverse. Origin stays centered — modals aren't
 * anchored to a trigger, so the popover origin rule doesn't apply.
 */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const { mounted, state } = usePresence(open, 150);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-state={state}>
      <div
        className="fk-presence absolute inset-0 bg-black/40 transition-opacity duration-200 ease-out data-[state=closed]:opacity-0 data-[state=closed]:duration-150"
        data-state={state}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-state={state}
        className="fk-presence relative flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-border bg-background shadow-xl transition-[transform,opacity] duration-200 ease-out data-[state=closed]:scale-[0.97] data-[state=closed]:opacity-0 data-[state=closed]:duration-150"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            &#10005;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
