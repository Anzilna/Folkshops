"use client";

import { Button, Card, Field, Input, Select } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { errorMessage } from "../../../lib/hooks";
import { EditorJsField } from "./editor-js-field";
import { ImageGalleryField } from "./image-gallery-field";
import { ImageUploadField } from "./image-upload-field";

export interface ProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  images: string[];
  priceCents: number;
  status: "draft" | "active" | "archived";
  categoryId: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Shared by /products/new and /products/[id] — a page-level form, not a
 * modal, so a half-filled product survives a refresh via the URL and the
 * browser back button behaves the way people expect. */
export function ProductForm({ product, tenantSlug }: { product: ProductRow | null; tenantSlug: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!product);
  // Read via a ref, not state — Editor.js's own onChange fires on every
  // keystroke; routing that through a React state update on this
  // component would re-render (and, worse, re-init further down) far
  // more than the editor itself needs.
  const descriptionRef = useRef(product?.description ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(product?.imageUrl ?? null);
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [priceRupees, setPriceRupees] = useState(product ? String(product.priceCents / 100) : "");
  const [status, setStatus] = useState<string>(product?.status ?? "draft");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (tenantSlug === null) return;
    apiFetch("/categories?limit=100&sortBy=name", {}, tenantSlug)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setCategories(body.data ?? []))
      .catch(() => setCategories([]));
  }, [tenantSlug]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const priceCents = Math.round(Number(priceRupees) * 100);
      if (!Number.isFinite(priceCents) || priceCents < 0) throw new Error("Enter a valid price");

      const body = {
        name,
        slug,
        description: descriptionRef.current || undefined,
        imageUrl: imageUrl || undefined,
        images,
        priceCents,
        status,
        categoryId: categoryId || undefined,
      };
      const res = await apiFetch(
        product ? `/products/${product.id}` : "/products",
        { method: product ? "PATCH" : "POST", body: JSON.stringify(body) },
        tenantSlug,
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Save failed"));
      router.push("/products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="flex flex-col gap-5">
        <Field label="Name" htmlFor="p-name">
          <Input
            id="p-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
            autoFocus={!product}
          />
        </Field>
        <Field label="Slug" htmlFor="p-slug" hint="Lowercase letters, numbers and hyphens. Part of the product's URL.">
          <Input
            id="p-slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            required
            pattern="[a-z0-9\-]+"
          />
        </Field>
        <Field label="Description" htmlFor="p-description">
          {/* Uncontrolled by design — see descriptionRef above. Keyed by
              product id so switching from one product's edit page to
              another's (both /products/[id], same component instance)
              tears down and reconstructs Editor.js instead of feeding it
              a new product's data through its own internal state. */}
          <EditorJsField
            key={product?.id ?? "new"}
            holderId={`p-description-${product?.id ?? "new"}`}
            initialValue={descriptionRef.current}
            onChange={(json) => {
              descriptionRef.current = json;
            }}
          />
        </Field>
      </Card>

      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-5">
          <Field label="Cover image" htmlFor="p-image">
            <ImageUploadField value={imageUrl} onChange={setImageUrl} tenantSlug={tenantSlug} />
          </Field>
          <Field label="Additional photos" htmlFor="p-gallery" hint="Shown in the storefront's product gallery, in this order.">
            <ImageGalleryField value={images} onChange={setImages} tenantSlug={tenantSlug} />
          </Field>
          <Field label="Price (INR)" htmlFor="p-price">
            <Input id="p-price" type="number" step="0.01" min="0" inputMode="decimal" value={priceRupees} onChange={(e) => setPriceRupees(e.target.value)} required />
          </Field>
          <Field label="Status" htmlFor="p-status">
            <Select id="p-status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} />
          </Field>
          <Field label="Category" htmlFor="p-category">
            <Select
              id="p-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="No category"
            />
          </Field>
        </Card>

        {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Link href="/products">
            <Button variant="outline" type="button">
              Cancel
            </Button>
          </Link>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : product ? "Save changes" : "Create product"}
          </Button>
        </div>
      </div>
    </form>
  );
}
