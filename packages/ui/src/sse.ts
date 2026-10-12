/**
 * Reads a Server-Sent Events response body, calling `onEvent` with each
 * `data:` line's parsed JSON. Resolves when the stream ends. Generic on
 * purpose — it knows nothing about any one endpoint's event shapes.
 */
export async function readSse<T = unknown>(res: Response, onEvent: (event: T) => void): Promise<void> {
  if (!res.body) throw new Error("This response has no body to stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events are separated by a blank line; keep any trailing partial one.
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const data = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as T);
    }
  }
}
