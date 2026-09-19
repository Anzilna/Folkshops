import type { ReactNode } from "react";

/**
 * Renders a product's description — Editor.js JSON (anything saved
 * through merchant-admin's product form) or a plain string (seed data,
 * CSV imports, which never go through the editor). No editor runtime is
 * loaded here; this is a static block-JSON-to-JSX renderer, read-only,
 * covering exactly the tools merchant-admin's EditorJsField offers
 * (paragraph, header, list) so a block type never silently vanishes on
 * the read side. Anything that doesn't parse as Editor.js JSON — plain
 * text — renders as-is; see merchant-admin's parseDescription() for the
 * mirror-image case (loading a plain string back into the editor).
 */
export function renderDescription(raw: string | null): ReactNode {
  if (!raw) return null;

  const blocks = parseBlocks(raw);
  if (!blocks) {
    return raw.split("\n").map((line, i) => (line.trim() ? <p key={i}>{line}</p> : null));
  }
  if (blocks.length === 0) return null;

  return blocks.map((block, i) => {
    const data = block.data;
    switch (block.type) {
      case "header": {
        const level = Math.min(6, Math.max(1, Number(data.level) || 2));
        const text = typeof data.text === "string" ? data.text : "";
        const props = { dangerouslySetInnerHTML: { __html: sanitizeInline(text) } };
        switch (level) {
          case 1:
            return <h1 key={i} {...props} />;
          case 2:
            return <h2 key={i} {...props} />;
          case 3:
            return <h3 key={i} {...props} />;
          case 4:
            return <h4 key={i} {...props} />;
          case 5:
            return <h5 key={i} {...props} />;
          default:
            return <h6 key={i} {...props} />;
        }
      }
      case "list": {
        const items = Array.isArray(data.items) ? data.items : [];
        const style = typeof data.style === "string" ? data.style : "unordered";
        return renderList(items, style, i);
      }
      case "paragraph":
      default: {
        const text = typeof data.text === "string" ? data.text : "";
        if (!text.trim()) return null;
        return <p key={i} dangerouslySetInnerHTML={{ __html: sanitizeInline(text) }} />;
      }
    }
  });
}

interface EditorBlock {
  type: string;
  data: Record<string, unknown>;
}

// @editorjs/list@2.0.9's actual output — confirmed against its own bundled
// README (not the plain string[] an earlier version of this tool used):
// each item is `{content, items?, meta?}`, `items` supporting arbitrary
// nesting (the tool's whole selling point) and `meta.checked` only
// meaningful for style: "checklist". A plain string is handled too, purely
// defensively (mirrors parseDescription()'s own "never trust the shape"
// posture) — nothing in this codebase actually produces one anymore.
interface EditorListItem {
  content?: string;
  items?: unknown;
  meta?: { checked?: boolean };
}

function renderList(items: unknown[], style: string, key: number): ReactNode {
  const ordered = style === "ordered";
  const checklist = style === "checklist";
  const itemNodes = items.map((raw, j) => {
    const item: EditorListItem = typeof raw === "string" ? { content: raw } : ((raw as EditorListItem) ?? {});
    const text = typeof item.content === "string" ? item.content : "";
    const nested = Array.isArray(item.items) ? item.items : [];
    return (
      <li key={j}>
        {checklist && (
          <input type="checkbox" checked={item.meta?.checked === true} readOnly disabled className="mr-2 align-middle" />
        )}
        <span dangerouslySetInnerHTML={{ __html: sanitizeInline(text) }} />
        {nested.length > 0 && renderList(nested, style, j)}
      </li>
    );
  });
  return ordered ? (
    <ol key={key} className="list-decimal pl-5">
      {itemNodes}
    </ol>
  ) : (
    <ul key={key} className={`pl-5 ${checklist ? "list-none" : "list-disc"}`}>
      {itemNodes}
    </ul>
  );
}

function parseBlocks(raw: string): EditorBlock[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.blocks)) return parsed.blocks;
  } catch {
    /* not JSON — plain text */
  }
  return null;
}

// Editor.js's inline toolbar can only ever produce a small, fixed set of
// tags (bold/italic/link/etc.) — allowlist those and strip everything
// else, rather than trusting the stored HTML wholesale. This runs on
// content staff members entered in their own store's product form, not
// arbitrary user input, but the allowlist costs nothing and means a typo
// in a future tool's output can't inject a stray <script>.
const ALLOWED_TAGS = /^(b|strong|i|em|a|mark|code|br)$/i;
function sanitizeInline(html: string): string {
  return html.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, tag: string, attrs: string) => {
    if (!ALLOWED_TAGS.test(tag)) return "";
    if (tag.toLowerCase() === "a") {
      const hrefMatch = attrs.match(/href\s*=\s*["']([^"']*)["']/i);
      const href = hrefMatch ? hrefMatch[1] : "";
      // Only http(s) links — blocks javascript: and other script-bearing schemes.
      if (!/^https?:\/\//i.test(href)) return "";
      return full.startsWith("</") ? "</a>" : `<a href="${href}" rel="noopener noreferrer" target="_blank">`;
    }
    return full.startsWith("</") ? `</${tag}>` : `<${tag}>`;
  });
}
