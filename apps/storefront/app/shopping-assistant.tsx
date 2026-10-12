"use client";

import { ChatWidget, readSse, type ChatReply } from "@folkshops/ui";
import Link from "next/link";
import { useRef } from "react";
import { notifyCartChanged } from "../lib/api";

interface AgentChatResponse {
  conversation_id: string;
  answer: string;
  citations: { filename: string | null }[];
  activity: { tool: string; status: string }[];
}

type AgentStreamEvent =
  | { type: "tool"; tool: string; status: string }
  | { type: "done"; response: AgentChatResponse }
  | { type: "error"; status: number; message: string };

const TOOL_LABELS: Record<string, string> = {
  knowledge_search: "Checked store policies",
  search_products: "Searched products",
  get_product: "Looked at a product",
  get_cart: "Checked your cart",
  set_cart_item_quantity: "Updated your cart",
  list_my_orders: "Checked your orders",
  get_my_order: "Opened an order",
};

/**
 * The Shopper Assistant (apps/ai-service's agent, shopper profile). Goes
 * through "/ai/..." — next.config.ts proxies it to ai-service on this
 * store's own origin, so the customer cookie travels with it. The assistant
 * acts only as this signed-in customer: their own cart and orders, this
 * store's catalog.
 */
export function ShoppingAssistant({ storeName, signedIn }: { storeName: string; signedIn: boolean }) {
  const conversationId = useRef<string | null>(null);

  async function send(text: string, onProgress: (label: string) => void): Promise<ChatReply> {
    const res = await fetch("/ai/agent/chat/stream", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, conversation_id: conversationId.current, client_message_id: crypto.randomUUID() }),
    });
    if (res.status === 401) throw new Error("Your session expired. Please sign in again.");
    if (res.status === 409) throw new Error("Still working on your previous message.");
    if (res.status === 429) throw new Error("Too many messages — please wait a moment.");
    if (!res.ok) throw new Error("The assistant isn't available right now.");
    // One `tool` event per finished tool call, then a single `done` with the full
    // answer. If a proxy buffers the stream, progress just isn't live; the answer is unaffected.
    let result: AgentChatResponse | null = null;
    await readSse<AgentStreamEvent>(res, (event) => {
      if (event.type === "tool") {
        if (event.status !== "rejected") onProgress(TOOL_LABELS[event.tool] ?? event.tool);
      } else if (event.type === "done") {
        result = event.response;
      } else {
        throw new Error(event.status === 409 ? "Still working on your previous message." : event.message);
      }
    });
    if (!result) throw new Error("The assistant isn't available right now.");
    const body: AgentChatResponse = result;
    conversationId.current = body.conversation_id;

    // The header's cart badge re-counts itself on this event (add-to-cart
    // never navigates, and neither does the assistant).
    if (body.activity.some((a) => a.tool === "set_cart_item_quantity" && a.status === "succeeded")) notifyCartChanged();

    const activity = [...new Set(body.activity.filter((a) => a.status !== "rejected").map((a) => TOOL_LABELS[a.tool] ?? a.tool))];
    const sources = [...new Set(body.citations.map((c) => c.filename).filter((f): f is string => !!f))];
    return { text: body.answer, activity, sources };
  }

  return (
    <ChatWidget
      assistantName="Shopping assistant"
      onSend={send}
      subtitle={`Help with ${storeName}`}
      greeting={`Hi! I can help you find products at ${storeName}, answer questions about the store, update your cart and check your orders.`}
      suggestions={["What's popular right now?", "What's your return policy?", "Where's my latest order?"]}
      locked={
        signedIn ? undefined : (
          <p className="text-xs text-muted-foreground">
            <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
              Sign in
            </Link>{" "}
            to chat with the assistant.
          </p>
        )
      }
    />
  );
}
