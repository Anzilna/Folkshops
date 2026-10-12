"use client";

import { PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { NewAdminForm } from "./new-admin-form";

export default function NewAdminPage() {
  useBreadcrumbs([{ label: "Team", href: "/team" }, { label: "Add admin" }]);

  return (
    <>
      <PageHeader title="Add admin" description="Give a colleague access to Platform Admin. They can change the password you set in Settings." />
      <NewAdminForm />
    </>
  );
}
