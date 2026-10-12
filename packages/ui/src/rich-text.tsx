import type { ReactNode } from "react";

/**
 * Minimal, dependency-free Markdown for chat answers: **bold**, `code`,
 * "- " / "* " bullets and "1. " numbered lines. Everything is built as React
 * elements (never innerHTML), so model output can't inject markup.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-background px-1 py-0.5 text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${blocks.length}`} className={`my-1 space-y-0.5 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const match = bullet ?? numbered;
    if (match) {
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(inline(match[1]));
      continue;
    }
    flush();
    if (line.trim() === "") continue;
    blocks.push(
      <p key={`p${blocks.length}`} className="my-1 first:mt-0 last:mb-0">
        {inline(line)}
      </p>,
    );
  }
  flush();
  return <>{blocks}</>;
}
