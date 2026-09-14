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
        const props = { key: i, dangerouslySetInnerHTML: { __html: sanitizeInline(text) } };
        switch (level) {
          case 1:
            return <h1 {...props} />;
          case 2:
            return <h2 {...props} />;
          case 3:
            return <h3 {...props} />;
          case 4:
            return <h4 {...props} />;
          case 5:
            return <h5 {...props} />;
          default:
            return <h6 {...props} />;
        }
      }
      case "list": {
        const items = Array.isArray(data.items) ? (data.items as string[]) : [];
        const ordered = data.style === "ordered";
        const itemNodes = items.map((item, j) => <li key={j} dangerouslySetInnerHTML={{ __html: sanitizeInline(item) }} />);
        return ordered ? (
          <ol key={i} className="list-decimal pl-5">
            {itemNodes}
          </ol>
        ) : (
          <ul key={i} className="list-disc pl-5">
            {itemNodes}
          </ul>
        );
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
