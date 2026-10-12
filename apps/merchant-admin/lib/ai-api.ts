import { readSse, type PaginatedResult, type TableQueryParams } from "@folkshops/ui";

const AI_URL = process.env.NEXT_PUBLIC_AI_URL ?? "http://localhost:4400";

/**
 * apps/ai-service, called directly cross-origin with credentials — same
 * pattern as analytics-api.ts. It verifies the staff JWT cookie itself and
 * takes the tenant from it, so no X-Tenant-Id header is needed either.
 */
function aiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  // FormData must keep the browser's own multipart Content-Type (bug #13).
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return fetch(`${AI_URL}${path}`, { ...init, headers, credentials: "include" });
}

/** ai-service's 402 body is `{detail: {code, message}}`, everything else FastAPI's `{detail: "..."}`. */
async function aiError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  const detail = body?.detail;
  if (typeof detail === "string") return new Error(detail);
  if (detail?.message) return new Error(detail.message);
  return new Error(fallback);
}

export type EntitlementReason = "ok" | "not_in_plan" | "subscription_inactive" | "no_subscription";

export interface AiEntitlement {
  allowed: boolean;
  reason: EntitlementReason;
  plan_slug: string | null;
  plan_name: string | null;
  subscription_status: string | null;
}

/** Display only — every gated ai-service route re-checks the plan server-side. */
export async function fetchAiEntitlement(): Promise<AiEntitlement> {
  const res = await aiFetch("/entitlement");
  if (!res.ok) throw await aiError(res, "Couldn't check your plan");
  return res.json();
}

export type DocumentStatus = "uploaded" | "processing" | "indexed" | "failed";

export interface KnowledgeDocument {
  id: string;
  filename: string;
  mime_type: string;
  status: DocumentStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Same fetcher contract as lib/api.ts's createTableFetcher, pointed at ai-service. */
export async function fetchDocuments(params: TableQueryParams): Promise<PaginatedResult<KnowledgeDocument>> {
  const sp = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.sortBy) sp.set("sortBy", params.sortBy);
  if (params.sortDir) sp.set("sortDir", params.sortDir);
  if (params.search) sp.set("search", params.search);
  if (params.filters.status) sp.set("status", params.filters.status);
  const res = await aiFetch(`/documents?${sp}`);
  if (!res.ok) throw await aiError(res, `Failed to load documents (${res.status})`);
  return res.json();
}

export async function fetchDocument(id: string): Promise<KnowledgeDocument> {
  const res = await aiFetch(`/documents/${id}`);
  if (!res.ok) throw await aiError(res, "Failed to load document");
  return res.json();
}

const MIME_BY_EXTENSION: Record<string, string> = { md: "text/markdown", txt: "text/plain", html: "text/html", pdf: "application/pdf" };

export async function uploadDocument(file: File): Promise<KnowledgeDocument> {
  // Browsers often report "" for .md files, which ai-service would 415 —
  // fill the type in from the extension when the browser left it blank.
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const typed = file.type ? file : new File([file], file.name, { type: MIME_BY_EXTENSION[extension] ?? "" });
  const body = new FormData();
  body.append("file", typed);
  const res = await aiFetch("/documents", { method: "POST", body });
  if (!res.ok) throw await aiError(res, "Upload failed");
  return res.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await aiFetch(`/documents/${id}`, { method: "DELETE" });
  if (!res.ok) throw await aiError(res, "Delete failed");
}

export type AgentActionStatus = "pending" | "executing" | "succeeded" | "failed" | "unknown" | "expired" | "cancelled";

/** ai-service's ActionCard — built server-side from the validated proposal and a fresh read, never from the model's text. */
export interface AgentAction {
  id: string;
  tool: string;
  title: string;
  fields: { label: string; before: string | null; after: string }[];
  status: AgentActionStatus;
  expires_at: string;
  message: string | null;
}

interface AgentChatResponse {
  conversation_id: string;
  run_id: string;
  answer: string;
  status: string;
  citations: { document_id: string; filename: string | null }[];
  actions: AgentAction[];
  activity: { tool: string; status: string }[];
}

type AgentStreamEvent =
  | { type: "tool"; tool: string; status: string }
  | { type: "done"; response: AgentChatResponse }
  | { type: "error"; status: number; message: string };

const TOOL_LABELS: Record<string, string> = {
  knowledge_search: "Searched your documents",
  search_products: "Searched products",
  get_product: "Looked up a product",
  list_inventory: "Checked stock",
  search_orders: "Searched orders",
  get_order: "Opened an order",
  get_customer: "Looked up a customer",
  update_product: "Prepared a product change",
  set_inventory_quantity: "Prepared a stock change",
};

export async function sendAgentMessage(
  message: string,
  conversationId: string | null,
  onProgress?: (label: string) => void,
): Promise<{ answer: string; conversationId: string; sources: string[]; activity: string[]; actions: AgentAction[] }> {
  const res = await aiFetch("/agent/chat/stream", {
    method: "POST",
    // client_message_id: a retried request (flaky network) returns the
    // first answer instead of running the agent twice.
    body: JSON.stringify({ message, conversation_id: conversationId, client_message_id: crypto.randomUUID() }),
  });
  if (res.status === 429) throw await aiError(res, "You're sending messages too quickly. Wait a moment and try again.");
  if (res.status === 409) throw new Error("Still working on your previous message.");
  if (!res.ok) throw await aiError(res, "The copilot couldn't answer that.");

  // One `tool` event per finished tool call, then a single `done` carrying the
  // same body /agent/chat returns — so the answer never depends on the progress events.
  let body: AgentChatResponse | null = null;
  await readSse<AgentStreamEvent>(res, (event) => {
    if (event.type === "tool") {
      if (event.status !== "rejected") onProgress?.(TOOL_LABELS[event.tool] ?? event.tool);
    } else if (event.type === "done") {
      body = event.response;
    } else {
      throw new Error(event.status === 409 ? "Still working on your previous message." : event.message);
    }
  });
  if (!body) throw new Error("The copilot couldn't answer that.");
  const done: AgentChatResponse = body;
  const sources = [...new Set(done.citations.map((c) => c.filename).filter((f): f is string => !!f))];
  const activity = [...new Set(done.activity.filter((a) => a.status !== "rejected").map((a) => TOOL_LABELS[a.tool] ?? a.tool))];
  return { answer: done.answer, conversationId: done.conversation_id, sources, activity, actions: done.actions };
}

/** Runs (or discards) a change the copilot proposed — exactly as shown on its card. */
export async function decideAgentAction(id: string, decision: "confirm" | "cancel"): Promise<AgentAction> {
  const res = await aiFetch(`/agent/actions/${id}/${decision}`, { method: "POST" });
  if (!res.ok) throw await aiError(res, decision === "confirm" ? "Couldn't apply that change." : "Couldn't cancel that change.");
  const body: { action: AgentAction } = await res.json();
  return body.action;
}

/** Mirrors ai-service's SUPPORTED_MIME_TYPES and MAX_UPLOAD_BYTES default — a pre-check only, the service enforces both. */
export const KNOWLEDGE_ACCEPT = ".pdf,.txt,.md,.html,application/pdf,text/plain,text/markdown,text/html";
export const KNOWLEDGE_MAX_BYTES = 20 * 1024 * 1024;
