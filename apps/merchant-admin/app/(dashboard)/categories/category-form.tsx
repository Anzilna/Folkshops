"use client";

import { Button, Card, Field, Input, Textarea } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../../../lib/api";
import { errorMessage } from "../../../lib/hooks";

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function CategoryForm({ category, tenantSlug }: { category: CategoryRow | null; tenantSlug: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!category);
  const [description, setDescription] = useState(category?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch(
        category ? `/categories/${category.id}` : "/categories",
        { method: category ? "PATCH" : "POST", body: JSON.stringify({ name, slug, description: description || undefined }) },
        tenantSlug,
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Save failed"));
      router.push("/categories");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6">
      <Card className="flex flex-col gap-5">
        <Field label="Name" htmlFor="c-name">
          <Input
            id="c-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
            autoFocus={!category}
          />
        </Field>
        <Field label="Slug" htmlFor="c-slug" hint="Lowercase letters, numbers and hyphens.">
          <Input
            id="c-slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            required
            pattern="[a-z0-9-]+"
          />
        </Field>
        <Field label="Description" htmlFor="c-description">
          <Textarea id="c-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </Field>
      </Card>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Link href="/categories">
          <Button variant="outline" type="button">
            Cancel
          </Button>
        </Link>
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? "Saving..." : category ? "Save changes" : "Create category"}
        </Button>
      </div>
    </form>
  );
}
