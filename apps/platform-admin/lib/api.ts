const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export { API_URL };

/** For use in the browser (client components) — the browser attaches cookies itself via credentials: "include". */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}
