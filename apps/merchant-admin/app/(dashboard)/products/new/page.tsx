"use client";

import { PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useTenantSlug } from "../../../../lib/hooks";
import { ProductForm } from "../product-form";

export default function NewProductPage() {
  useBreadcrumbs([{ label: "Products", href: "/products" }, { label: "New product" }]);
  const tenantSlug = useTenantSlug();

  return (
    <>
      <PageHeader title="New product" description="It starts as a draft — set it to Active when it's ready to sell." />
      <ProductForm product={null} tenantSlug={tenantSlug} />
    </>
  );
}
