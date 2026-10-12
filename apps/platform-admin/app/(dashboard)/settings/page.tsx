"use client";

import { PageHeader, useBreadcrumbs } from "@folkshops/ui";
import { useEffect, useState } from "react";
import { Panel } from "../../panel";
import { fetchCurrentAdmin } from "../../../lib/platform-api";
import { ChangePasswordForm } from "./change-password-form";

export default function SettingsPage() {
  useBreadcrumbs([{ label: "Settings" }]);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrentAdmin()
      .then((a) => setEmail(a.email))
      .catch(() => setEmail(null));
  }, []);

  return (
    <>
      <PageHeader title="Settings" description="Your own Platform Admin account." />

      <div className="flex max-w-xl flex-col gap-6">
        <Panel>
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-medium">Account</h2>
          </div>
          <dl className="px-6 py-4">
            <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
              <dt className="text-muted-foreground">Signed in as</dt>
              <dd className="font-medium">{email ?? "—"}</dd>
            </div>
          </dl>
        </Panel>

        <Panel>
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-medium">Change password</h2>
            <p className="mt-1 text-xs text-muted-foreground">Changing it signs you out of every other device.</p>
          </div>
          <div className="px-6 py-5">
            <ChangePasswordForm />
          </div>
        </Panel>
      </div>
    </>
  );
}
