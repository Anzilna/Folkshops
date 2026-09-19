"use client";

import { Button, Card, ConfirmDialog, PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { useResource } from "../../../../lib/hooks";
import { ProductForm, type ProductRow } from "../product-form";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: product, loading, error, tenantSlug } = useResource<ProductRow>(`/products/${id}`);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useBreadcrumbs([{ label: "Products", href: "/products" }, { label: product?.name ?? "Edit" }]);

  async function remove() {
    const res = await apiFetch(`/products/${id}`, { method: "DELETE" }, tenantSlug);
    if (res.ok) router.push("/products");
  }

  if (error) {
    return (
      <Card className="text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/products")}>
          Back to products
        </Button>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={product?.name ?? "Edit product"}
        description={product ? `Added ${new Date(product.createdAt).toLocaleDateString("en-AE")}` : undefined}
        actions={
          product && (
            <Button variant="outline" className="text-destructive" onClick={() => setConfirmOpen(true)}>
              Delete
            </Button>
          )
        }
      />
      {loading || !product ? (
        <Card className="h-64 animate-pulse bg-muted/40" />
      ) : (
        // key forces a fresh form when navigating between two products' edit pages.
        <ProductForm key={product.id} product={product} tenantSlug={tenantSlug} />
      )}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
        title={`Delete "${product?.name}"?`}
        description="Removes it from your catalog and every listing. Orders that already include it keep their own snapshot."
      />
    </>
  );
}
