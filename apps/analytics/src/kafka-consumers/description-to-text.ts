/**
 * products.description holds either plain text (seed data, CSV import) or
 * Editor.js's stringified JSON (merchant-admin's editor) — see storefront's
 * lib/editorjs-render.tsx, the reader-side twin of this. Indexing the raw
 * JSON would make searches for "blocks", "paragraph" or "version" match
 * every edited product, so only the human-readable text goes to search.
 */
interface EditorJsBlock {
  type: string;
  data?: { text?: string; items?: unknown[] };
}

type ListItem = string | { content?: string; items?: ListItem[] };

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function listItemsText(items: ListItem[]): string[] {
  return items.flatMap((item) =>
    typeof item === "string" ? [item] : [item.content ?? "", ...listItemsText(item.items ?? [])],
  );
}

export function descriptionToPlainText(description: string | null): string | null {
  if (!description) return description;
  let parsed: { blocks?: EditorJsBlock[] };
  try {
    parsed = JSON.parse(description);
  } catch {
    return description; // plain-text description
  }
  if (!parsed || !Array.isArray(parsed.blocks)) return description;

  const parts = parsed.blocks.flatMap((block) => {
    if (block.data?.text) return [block.data.text];
    if (Array.isArray(block.data?.items)) return listItemsText(block.data.items as ListItem[]);
    return [];
  });
  return stripHtml(parts.join(" ")).replace(/\s+/g, " ").trim() || null;
}
