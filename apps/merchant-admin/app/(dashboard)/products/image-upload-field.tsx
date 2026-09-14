"use client";

import { Button } from "@folkshops/ui";
import { useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";

const MAX_BYTES = 5 * 1024 * 1024;

interface ImageUploadFieldProps {
  value: string | null;
  onChange: (url: string | null) => void;
  tenantSlug: string | null;
}

/**
 * Uploads immediately on file selection (POST /uploads/product-image, see
 * core-api's UploadsController) rather than waiting for the product
 * form's own Save — the image is already a real S3 object with its own
 * URL before the form ever submits, so Save just attaches that URL like
 * any other field. Matches core-api's own limits (5MB, JPEG/PNG/WebP/GIF)
 * so a bad file is rejected before spending a round trip on it.
 */
export function ImageUploadField({ value, onChange, tenantSlug }: ImageUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("Image must be 5MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch("/uploads/product-image", { method: "POST", body: form }, tenantSlug);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? "Upload failed");
      }
      const { url } = await res.json();
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30 transition-colors ${
          uploading ? "opacity-60" : "hover:border-foreground/30"
        }`}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- external S3/MinIO URL, not a local asset next/image can optimize
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 p-4 text-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-muted-foreground">
              <path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v13a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 18.5v-13z" stroke="currentColor" strokeWidth="1.6" />
              <path d="M4 16l4.5-4.5a2 2 0 012.8 0L15 15l1.3-1.3a2 2 0 012.8 0L20 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            <span className="text-xs text-muted-foreground">No image yet</span>
          </div>
        )}

        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <span className="text-xs text-muted-foreground">Uploading...</span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      <div className="flex gap-2">
        <Button variant="outline" size="sm" type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="flex-1">
          {value ? "Replace" : "Upload image"}
        </Button>
        {value && (
          <Button variant="ghost" size="sm" type="button" onClick={() => onChange(null)} disabled={uploading} className="text-destructive hover:bg-destructive/10">
            Remove
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
