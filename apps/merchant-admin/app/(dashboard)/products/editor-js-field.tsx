"use client";

import type { OutputData } from "@editorjs/editorjs";
import { useEffect, useRef } from "react";

/**
 * A product's description is stored as one opaque text column (see
 * schema/products.ts) that holds either Editor.js's JSON OutputData
 * (anything saved through this form) or a plain string (seed data, CSV
 * imports — neither goes through an editor). Parsing must accept both:
 * real Editor.js JSON is used as-is; anything else — including a bare
 * string that happens to look almost like JSON — is wrapped as a single
 * paragraph block so opening an old plain-text product for editing never
 * silently drops its content.
 */
export function parseDescription(raw: string | null | undefined): OutputData {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.blocks)) return parsed as OutputData;
    } catch {
      /* not JSON — plain text, fall through */
    }
  }
  return { blocks: raw ? [{ type: "paragraph", data: { text: raw } }] : [] };
}

interface EditorJsFieldProps {
  holderId: string;
  initialValue: string;
  onChange: (json: string) => void;
}

/**
 * Thin wrapper around Editor.js — a block editor, not a plain textarea, so
 * a product description can have headings and lists. Editor.js is DOM-
 * heavy and has no SSR story, so everything here (construction, teardown)
 * only ever runs client-side inside useEffect; the holder div itself
 * renders an empty shell on the server.
 */
export function EditorJsField({ holderId, initialValue, onChange }: EditorJsFieldProps) {
  // onChange is read through a ref, not a useEffect dependency — Editor.js
  // is constructed once per mount (its own internal state would be lost on
  // a re-init), so the effect below intentionally has an empty deps array.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let editor: import("@editorjs/editorjs").default | null = null;
    let destroyed = false;

    async function init() {
      const [{ default: EditorJS }, { default: Header }, { default: List }] = await Promise.all([
        import("@editorjs/editorjs"),
        import("@editorjs/header"),
        import("@editorjs/list"),
      ]);
      if (destroyed) return;

      editor = new EditorJS({
        holder: holderId,
        data: parseDescription(initialValue),
        placeholder: "Describe the product...",
        tools: {
          header: { class: Header as never, inlineToolbar: true },
          list: { class: List as never, inlineToolbar: true },
        },
        onChange: async (api) => {
          const data = await api.saver.save();
          onChangeRef.current(JSON.stringify(data));
        },
      });
    }

    init();

    return () => {
      destroyed = true;
      editor?.isReady
        .then(() => editor?.destroy())
        .catch(() => {
          /* never finished initializing — nothing to tear down */
        });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holderId]);

  return (
    <div
      id={holderId}
      className="prose prose-sm max-w-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground [&_.ce-block]:max-w-none [&_.codex-editor__redactor]:!pb-2"
    />
  );
}
