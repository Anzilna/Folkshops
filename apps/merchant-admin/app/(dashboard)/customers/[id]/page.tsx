"use client";

import { Button, Card, ConfirmDialog, PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { useResource } from "../../../../lib/hooks";
import { CustomerForm, type CustomerRow } from "../customer-form";

export default function EditCustomerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: customer, loading, error, tenantSlug } = useResource<CustomerRow>(`/customers/${id}`);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useBreadcrumbs([{ label: "Customers", href: "/customers" }, { label: customer?.name || customer?.phone || "Edit" }]);

  if (error) {
    return (
      <Card className="text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/customers")}>
          Back to customers
        </Button>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={customer?.name || customer?.phone || "Edit customer"}
        description={customer ? `Customer since ${new Date(customer.createdAt).toLocaleDateString("en-IN")}` : undefined}
        actions={
          customer && (
            <Button variant="outline" className="text-destructive" onClick={() => setConfirmOpen(true)}>
              Delete
            </Button>
          )
        }
      />
      {loading || !customer ? <Card className="h-40 animate-pulse bg-muted/40" /> : <CustomerForm key={customer.id} customer={customer} tenantSlug={tenantSlug} />}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const res = await apiFetch(`/customers/${id}`, { method: "DELETE" }, tenantSlug);
          if (res.ok) router.push("/customers");
        }}
        title={`Delete ${customer?.name || customer?.phone}?`}
        description="This removes the customer record. Their past orders are kept."
      />
    </>
  );
}
