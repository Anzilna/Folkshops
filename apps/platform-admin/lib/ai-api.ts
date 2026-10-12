import type { PaginatedResult, TableQueryParams } from "@folkshops/ui";

const AI_URL = process.env.NEXT_PUBLIC_AI_URL ?? "http://localhost:4400";

/**
 * apps/ai-service's /platform/documents, called directly cross-origin with
 * credentials (same pattern as merchant-admin's lib/ai-api.ts). It verifies
 * the platform-admin cookie itself with its own secret — a store-staff
 * session can't reach these routes.
 */
function aiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  // FormData must keep the browser's own multipart Content-Type (bug #13).
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return fetch(`${AI_URL}${path}`, { ...init, headers, credentials: "include" });
}

async function aiError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(typeof body?.detail === "string" ? body.detail : fallback);
}

export type DocumentStatus = "uploaded" | "processing" | "indexed" | "failed";

export interface HelpDocument {
  id: string;
  filename: string;
  mime_type: string;
  status: DocumentStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchHelpDocuments(params: TableQueryParams): Promise<PaginatedResult<HelpDocument>> {
  const sp = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.sortBy) sp.set("sortBy", params.sortBy);
  if (params.sortDir) sp.set("sortDir", params.sortDir);
  if (params.search) sp.set("search", params.search);
  if (params.filters.status) sp.set("status", params.filters.status);
  const res = await aiFetch(`/platform/documents?${sp}`);
  if (!res.ok) throw await aiError(res, `Failed to load documents (${res.status})`);
  return res.json();
}

export async function fetchHelpDocument(id: string): Promise<HelpDocument> {
  const res = await aiFetch(`/platform/documents/${id}`);
  if (!res.ok) throw await aiError(res, "Failed to load document");
  return res.json();
}

const MIME_BY_EXTENSION: Record<string, string> = { md: "text/markdown", txt: "text/plain", html: "text/html", pdf: "application/pdf" };

export async function uploadHelpDocument(file: File): Promise<HelpDocument> {
  // Browsers often report "" for .md files, which ai-service would 415.
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const typed = file.type ? file : new File([file], file.name, { type: MIME_BY_EXTENSION[extension] ?? "" });
  const body = new FormData();
  body.append("file", typed);
  const res = await aiFetch("/platform/documents", { method: "POST", body });
  if (!res.ok) throw await aiError(res, "Upload failed");
  return res.json();
}

export async function deleteHelpDocument(id: string): Promise<void> {
  const res = await aiFetch(`/platform/documents/${id}`, { method: "DELETE" });
  if (!res.ok) throw await aiError(res, "Delete failed");
}

/** Mirrors ai-service's SUPPORTED_MIME_TYPES and MAX_UPLOAD_BYTES default — a pre-check only, the service enforces both. */
export const HELP_DOCS_ACCEPT = ".pdf,.txt,.md,.html,application/pdf,text/plain,text/markdown,text/html";
export const HELP_DOCS_MAX_BYTES = 20 * 1024 * 1024;
