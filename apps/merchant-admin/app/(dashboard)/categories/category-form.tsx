"use client";

import { Button, Input, Label, Modal } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export function CategoryForm({
  open,
  onClose,
  onSaved,
  category,
  tenantSlug,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  category: CategoryRow | null;
  tenantSlug: string | null;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setSlug(category?.slug ?? "");
    setDescription(category?.description ?? "");
    setError(null);
  }, [open, category]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = { name, slug, description: description || undefined };
      const res = await apiFetch(
        category ? `/categories/${category.id}` : "/categories",
        { method: category ? "PATCH" : "POST", body: JSON.stringify(body) },
        tenantSlug,
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(Array.isArray(errBody?.message) ? errBody.message.join(", ") : (errBody?.message ?? "Save failed"));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={category ? "Edit category" : "New category"}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="c-name">Name</Label>
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="c-slug">Slug</Label>
          <Input id="c-slug" value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[a-z0-9-]+" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="c-description">Description</Label>
          <textarea
            id="c-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
