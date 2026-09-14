"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePresence } from "./use-presence";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
}

/**
 * UI-only stand-in for the Phase 3 Merchant Copilot (CLAUDE.md build
 * order) — no model, no backend, no tool calls. Replies are canned so the
 * panel, message list, typing state and input can be designed and reviewed
 * now; the real agent slots in behind the same `reply()` seam later.
 */
function reply(text: string): string {
  const t = text.toLowerCase();
  if (/order/.test(t)) return "You have 120 orders, 14 of them cancelled. Want me to open the ones from this week?";
  if (/stock|inventory/.test(t)) return "18 products are out of stock and 27 are running low. I can export that list as a CSV if you'd like.";
  if (/customer/.test(t)) return "75 customers so far — 6 joined in the last week. Most sign up through OTP login on the storefront.";
  if (/product|catalog/.test(t)) return "Your catalog has 180 products across 10 categories. 72% are active, the rest are drafts or archived.";
  if (/hi|hello|hey/.test(t)) return "Hi! Ask me about orders, stock, customers or products — I'm a placeholder until the real copilot ships in Phase 3.";
  return "I'm a demo for now — the real Merchant Copilot arrives in Phase 3. Try asking about orders, inventory, customers or products.";
}

const SUGGESTIONS = ["Anything out of stock?", "How are orders this week?", "New customers?"];

export function ChatWidget({ assistantName = "Copilot" }: { assistantName?: string }) {
  const [open, setOpen] = useState(false);
  const { mounted, state } = usePresence(open, 150);
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, role: "assistant", text: `Hi, I'm ${assistantName}. Ask me about your store — this is a preview, so answers are canned for now.` },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || typing) return;
    setMessages((m) => [...m, { id: Date.now(), role: "user", text: trimmed }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setMessages((m) => [...m, { id: Date.now() + 1, role: "assistant", text: reply(trimmed) }]);
      setTyping(false);
    }, 700 + Math.random() * 500);
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
              <p className="text-[11px] text-muted-foreground">Preview · answers are canned</p>
            </div>
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m) => (
              <div key={m.id} className={`fk-fade-in flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === "user" ? "rounded-br-md bg-accent text-accent-foreground" : "rounded-bl-md bg-muted text-foreground"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {typing && (
              <div className="fk-fade-in flex justify-start">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5">
                  <span className="fk-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  <span className="fk-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "120ms" }} />
                  <span className="fk-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "240ms" }} />
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
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
        </div>
      )}
    </>
  );
}
