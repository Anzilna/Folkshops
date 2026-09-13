"use client";

import { PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useTenantSlug } from "../../../../lib/hooks";
import { CustomerForm } from "../customer-form";

export default function NewCustomerPage() {
  useBreadcrumbs([{ label: "Customers", href: "/customers" }, { label: "New customer" }]);
  const tenantSlug = useTenantSlug();

  return (
    <>
      <PageHeader title="New customer" description="For customers you're adding by hand — most will create themselves by logging in." />
      <CustomerForm customer={null} tenantSlug={tenantSlug} />
    </>
  );
}
