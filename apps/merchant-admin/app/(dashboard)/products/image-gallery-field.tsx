"use client";

import { useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";

const MAX_BYTES = 5 * 1024 * 1024;

interface ImageGalleryFieldProps {
  value: string[];
  onChange: (urls: string[]) => void;
  tenantSlug: string | null;
}

/**
 * Additional photos beyond the single cover image (ImageUploadField) —
 * saved as a plain ordered array on the product (see products.service.ts's
 * replaceGallery), not individual rows with their own endpoints. Each
 * upload still goes through the same POST /uploads/product-image as the
 * cover photo; this only manages the array of resulting URLs.
 */
export function ImageGalleryField({ value, onChange, tenantSlug }: ImageGalleryFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList) {
    setError(null);
    const oversized = Array.from(files).find((f) => f.size > MAX_BYTES);
    if (oversized) {
      setError(`"${oversized.name}" is over 5MB.`);
      return;
    }
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await apiFetch("/uploads/product-image", { method: "POST", body: form }, tenantSlug);
        if (!res.ok) throw new Error("Upload failed");
        const { url } = await res.json();
        uploaded.push(url);
      }
      onChange([...value, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function remove(url: string) {
    onChange(value.filter((u) => u !== url));
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...value];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {value.map((url, i) => (
            <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element -- external S3/MinIO URL */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/0 opacity-0 transition-opacity group-hover:bg-background/70 group-hover:opacity-100">
                <div className="flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded bg-background px-1.5 py-0.5 text-xs shadow disabled:opacity-30">
                    &larr;
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="rounded bg-background px-1.5 py-0.5 text-xs shadow disabled:opacity-30">
                    &rarr;
                  </button>
                </div>
                <button type="button" onClick={() => remove(url)} className="rounded bg-destructive px-1.5 py-0.5 text-xs text-destructive-foreground shadow">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
      >
        {uploading ? "Uploading..." : "Add photos"}
      </button>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
