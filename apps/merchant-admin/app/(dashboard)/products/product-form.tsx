"use client";

import { Button, Input, Label, Modal, Select } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

export interface ProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  status: "draft" | "active" | "archived";
  categoryId: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

export function ProductForm({
  open,
  onClose,
  onSaved,
  product,
  tenantSlug,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  product: ProductRow | null;
  tenantSlug: string | null;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [priceRupees, setPriceRupees] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? "");
    setSlug(product?.slug ?? "");
    setDescription(product?.description ?? "");
    setPriceRupees(product ? String(product.priceCents / 100) : "");
    setStatus(product?.status ?? "draft");
    setCategoryId(product?.categoryId ?? "");
    setError(null);

    apiFetch("/categories?limit=100", {}, tenantSlug)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setCategories(body.data ?? []))
      .catch(() => setCategories([]));
  }, [open, product, tenantSlug]);

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
        description: description || undefined,
        priceCents,
        status,
        categoryId: categoryId || undefined,
      };

      const res = await apiFetch(
        product ? `/products/${product.id}` : "/products",
        { method: product ? "PATCH" : "POST", body: JSON.stringify(body) },
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
    <Modal open={open} onClose={onClose} title={product ? "Edit product" : "New product"}>
      <form id="product-form" onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="p-name">Name</Label>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="p-slug">Slug</Label>
          <Input id="p-slug" value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[a-z0-9-]+" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="p-price">Price (INR)</Label>
          <Input id="p-price" type="number" step="0.01" min="0" value={priceRupees} onChange={(e) => setPriceRupees(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="p-status">Status</Label>
          <Select id="p-status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="p-category">Category</Label>
          <Select
            id="p-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="No category"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="p-description">Description</Label>
          <textarea
            id="p-description"
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
