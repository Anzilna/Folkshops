"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { RichText } from "./rich-text";
import { usePresence } from "./use-presence";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  sources?: string[];
  activity?: string[];
  actions?: ChatAction[];
  error?: boolean;
}

export type ChatActionStatus = "pending" | "executing" | "succeeded" | "failed" | "unknown" | "expired" | "cancelled";

/**
 * A change the assistant proposed, shown as a card the user must confirm.
 * Rendered from server data (the backend builds title/fields from the real
 * current values) — never from the assistant's own wording.
 */
export interface ChatAction {
  id: string;
  title: string;
  fields: { label: string; before?: string | null; after: string }[];
  status: ChatActionStatus;
  message?: string | null;
}

export interface ChatReply {
  text: string;
  /** Shown under the answer — e.g. the knowledge-base filenames it was grounded in. */
  sources?: string[];
  /** What the assistant did to answer, e.g. ["Searched products", "Checked stock"]. */
  activity?: string[];
  actions?: ChatAction[];
}

export interface ChatWidgetProps {
  assistantName?: string;
  /** The real backend. Throw to show the error's message as a failed reply.
   * Omitted = preview mode with canned replies (platform-admin today).
   * `onProgress` is optional to call: pass it a short label (e.g. "Searched
   * products") as each step finishes and it shows beside the typing dots. */
  onSend?: (text: string, onProgress: (label: string) => void) => Promise<ChatReply>;
  /** Confirm or cancel a proposed action; resolves to its updated state. Throw to show an error on the card. */
  onAction?: (actionId: string, decision: "confirm" | "cancel") => Promise<ChatAction>;
  /** Rendered in place of the composer when the assistant isn't available
   * (e.g. the store's plan doesn't include AI). */
  locked?: ReactNode;
  greeting?: string;
  subtitle?: string;
  suggestions?: string[];
}

/**
 * Canned replies for preview mode (no `onSend`) — lets the panel be
 * designed and reviewed in an app with no AI backend behind it.
 */
function cannedReply(text: string): string {
  const t = text.toLowerCase();
  if (/order/.test(t)) return "You have 120 orders, 14 of them cancelled. Want me to open the ones from this week?";
  if (/stock|inventory/.test(t)) return "18 products are out of stock and 27 are running low. I can export that list as a CSV if you'd like.";
  if (/customer/.test(t)) return "75 customers so far — 6 joined in the last week. Most sign up through OTP login on the storefront.";
  if (/product|catalog/.test(t)) return "Your catalog has 180 products across 10 categories. 72% are active, the rest are drafts or archived.";
  if (/hi|hello|hey/.test(t)) return "Hi! Ask me about orders, stock, customers or products — I'm a placeholder until the real copilot ships in Phase 3.";
  return "I'm a demo for now — the real Merchant Copilot arrives in Phase 3. Try asking about orders, inventory, customers or products.";
}

const PREVIEW_SUGGESTIONS = ["Anything out of stock?", "How are orders this week?", "New customers?"];

const STATUS_LABEL: Record<Exclude<ChatActionStatus, "pending">, string> = {
  executing: "Applying…",
  succeeded: "Applied",
  failed: "Not applied",
  unknown: "Couldn't confirm",
  expired: "Expired",
  cancelled: "Cancelled",
};

function ActionCard({
  action,
  onDecide,
}: {
  action: ChatAction;
  onDecide?: (decision: "confirm" | "cancel") => void;
}) {
  const tone =
    action.status === "succeeded"
      ? "text-success"
      : action.status === "failed" || action.status === "unknown"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="mt-2 rounded-xl border border-border bg-background p-3 text-foreground">
      <p className="text-xs font-medium">{action.title}</p>
      <dl className="mt-2 space-y-1">
        {action.fields.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="text-right">
              {f.before != null && <span className="text-muted-foreground line-through">{f.before}</span>}
              {f.before != null && <span className="px-1 text-muted-foreground">→</span>}
              <span className="font-medium">{f.after}</span>
            </dd>
          </div>
        ))}
      </dl>
      {action.status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!onDecide}
            onClick={() => onDecide?.("confirm")}
            className="h-8 flex-1 rounded-lg bg-accent text-xs font-medium text-accent-foreground transition-[opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-40"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={!onDecide}
            onClick={() => onDecide?.("cancel")}
            className="h-8 flex-1 rounded-lg border border-border text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      ) : (
        <p className={`mt-2 text-[11px] ${tone}`}>
          {STATUS_LABEL[action.status]}
          {action.message ? ` — ${action.message}` : ""}
        </p>
      )}
    </div>
  );
}

export function ChatWidget({ assistantName = "Copilot", onSend, onAction, locked, greeting, subtitle, suggestions }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const { mounted, state } = usePresence(open, 150);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: "assistant",
      text: greeting ?? `Hi, I'm ${assistantName}. Ask me about your store — this is a preview, so answers are canned for now.`,
    },
  ]);
  const chips = suggestions ?? (onSend ? [] : PREVIEW_SUGGESTIONS);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || typing || locked) return;
    setMessages((m) => [...m, { id: Date.now(), role: "user", text: trimmed }]);
    setInput("");
    setTyping(true);
    setProgress(null);

    let next: Omit<Message, "id">;
    if (onSend) {
      try {
        const res = await onSend(trimmed, setProgress);
        next = { role: "assistant", text: res.text, sources: res.sources, activity: res.activity, actions: res.actions };
      } catch (err) {
        next = { role: "assistant", text: err instanceof Error ? err.message : "Something went wrong.", error: true };
      }
    } else {
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 500));
      next = { role: "assistant", text: cannedReply(trimmed) };
    }
    setMessages((m) => [...m, { id: Date.now() + 1, ...next }]);
    setTyping(false);
    setProgress(null);
  }

  function patchAction(id: string, patch: Partial<ChatAction>) {
    setMessages((all) =>
      all.map((m) => (m.actions?.some((a) => a.id === id) ? { ...m, actions: m.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)) } : m)),
    );
  }

  async function decide(id: string, decision: "confirm" | "cancel") {
    if (!onAction) return;
    // Optimistic "Applying…" hides the buttons at once, so a double click
    // can't send a second request (the server also runs it at most once).
    patchAction(id, { status: decision === "confirm" ? "executing" : "cancelled", message: null });
    try {
      patchAction(id, await onAction(id, decision));
    } catch (err) {
      patchAction(id, { status: "failed", message: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? `Close ${assistantName}` : `Open ${assistantName}`}
        aria-expanded={open}
        className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg transition-transform duration-150 ease-out hover:scale-105 active:scale-[0.97]"
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8a2.5 2.5 0 01-2.5 2.5H10l-5 4v-4h-.5A2.5 2.5 0 012 13.5v-8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M8 8.5h8M8 12h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {mounted && (
        // Grows out of the button that opened it (bottom-right), scale from
        // 0.96 + opacity, and collapses back the same way on close.
        <div
          role="dialog"
          aria-label={assistantName}
          data-state={state}
          className="fk-presence fixed bottom-20 right-6 z-30 flex h-[32rem] w-[22rem] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl transition-[transform,opacity] duration-200 ease-out data-[state=closed]:translate-y-2 data-[state=closed]:scale-[0.96] data-[state=closed]:opacity-0 data-[state=closed]:duration-150"
        >
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <span className="fk-brand-mark flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold text-accent-foreground">AI</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{assistantName}</p>
              <p className="text-[11px] text-muted-foreground">{subtitle ?? "Preview · answers are canned"}</p>
            </div>
            <span className={`h-2 w-2 rounded-full ${locked ? "bg-muted-foreground/40" : "bg-success"}`} aria-hidden="true" />
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m) => (
              <div key={m.id} className={`fk-fade-in flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "rounded-br-md bg-accent text-accent-foreground"
                      : m.error
                        ? "rounded-bl-md bg-destructive/10 text-destructive"
                        : "rounded-bl-md bg-muted text-foreground"
                  }`}
                >
                  {m.activity && m.activity.length > 0 && (
                    <p className="mb-1 text-[11px] text-muted-foreground">{m.activity.join(" · ")}</p>
                  )}
                  {m.role === "assistant" && !m.error ? <RichText text={m.text} /> : m.text}
                  {m.actions?.map((a) => (
                    <ActionCard key={a.id} action={a} onDecide={onAction ? (d) => decide(a.id, d) : undefined} />
                  ))}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-border/60 pt-2">
                      {m.sources.map((source) => (
                        <span key={source} className="max-w-full truncate rounded-md bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {source}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {typing && (
              <div className="fk-fade-in flex justify-start">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5">
                  <span className="fk-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  <span className="fk-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "120ms" }} />
                  <span className="fk-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "240ms" }} />
                  {progress && <span className="ml-1.5 text-[11px] text-muted-foreground">{progress}</span>}
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && !locked && chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {chips.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {locked ? (
            <div className="border-t border-border p-3">{locked}</div>
          ) : (
            <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-border p-3">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your store..."
                className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <button
                type="submit"
                disabled={!input.trim() || typing}
                aria-label="Send"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-[opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
