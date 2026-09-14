"use client";

import { Button, Card, Checkbox, Field, Input, PageHeader, Select, useBreadcrumbs } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { errorMessage, useTenantSlug } from "../../../../lib/hooks";

export default function NewInventoryPage() {
  useBreadcrumbs([{ label: "Inventory", href: "/inventory" }, { label: "New record" }]);
  const router = useRouter();
  const tenantSlug = useTenantSlug();
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Up to 100 products, alphabetical — a searchable picker isn't worth
  // building until a store has more than a page of products to choose
  // from (@folkshops/ui has no combobox today, only a plain <select>).
  useEffect(() => {
    if (tenantSlug === null) return;
    apiFetch("/products?limit=100&sortBy=name", {}, tenantSlug)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setProducts(body.data ?? []))
      .catch(() => setProducts([]));
  }, [tenantSlug]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (!productId) throw new Error("Choose a product");
      const res = await apiFetch(
        "/inventory",
        { method: "POST", body: JSON.stringify({ productId, quantity: Number(quantity), isActive }) },
        tenantSlug,
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Save failed"));
      router.push("/inventory");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader title="New inventory record" description="Products already tracked here won't show up twice — edit their quantity from the list instead." />
      <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-6">
        <Card className="flex flex-col gap-5">
          <Field label="Product" htmlFor="inv-product">
            <Select
              id="inv-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              options={products.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Choose a product"
              required
              autoFocus
            />
          </Field>
          <Field label="Quantity" htmlFor="inv-quantity">
            <Input id="inv-quantity" type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        </Card>

        {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Link href="/inventory">
            <Button variant="outline" type="button">
              Cancel
            </Button>
          </Link>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Add record"}
          </Button>
        </div>
      </form>
    </>
  );
}
