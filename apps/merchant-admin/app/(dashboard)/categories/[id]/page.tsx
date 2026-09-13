"use client";

import { Button, Card, ConfirmDialog, PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { useResource } from "../../../../lib/hooks";
import { CategoryForm, type CategoryRow } from "../category-form";

export default function EditCategoryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: category, loading, error, tenantSlug } = useResource<CategoryRow>(`/categories/${id}`);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useBreadcrumbs([{ label: "Categories", href: "/categories" }, { label: category?.name ?? "Edit" }]);

  if (error) {
    return (
      <Card className="text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/categories")}>
          Back to categories
        </Button>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={category?.name ?? "Edit category"}
        actions={
          category && (
            <Button variant="outline" className="text-destructive" onClick={() => setConfirmOpen(true)}>
              Delete
            </Button>
          )
        }
      />
      {loading || !category ? <Card className="h-48 animate-pulse bg-muted/40" /> : <CategoryForm key={category.id} category={category} tenantSlug={tenantSlug} />}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const res = await apiFetch(`/categories/${id}`, { method: "DELETE" }, tenantSlug);
          if (res.ok) router.push("/categories");
        }}
        title={`Delete "${category?.name}"?`}
        description="Products in this category keep existing — they just become uncategorized."
      />
    </>
  );
}
