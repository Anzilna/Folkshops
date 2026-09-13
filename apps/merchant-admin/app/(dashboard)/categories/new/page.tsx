"use client";

import { PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useTenantSlug } from "../../../../lib/hooks";
import { CategoryForm } from "../category-form";

export default function NewCategoryPage() {
  useBreadcrumbs([{ label: "Categories", href: "/categories" }, { label: "New category" }]);
  const tenantSlug = useTenantSlug();

  return (
    <>
      <PageHeader title="New category" />
      <CategoryForm category={null} tenantSlug={tenantSlug} />
    </>
  );
}
