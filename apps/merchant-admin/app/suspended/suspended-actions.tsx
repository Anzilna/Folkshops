"use client";

import { Button } from "@folkshops/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, TENANT_SLUG_COOKIE } from "../../lib/api";

export function SuspendedActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      // No store header on purpose: logout only needs the refresh cookie,
      // and the server lets it through for a suspended store regardless.
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      // Forget the remembered store too, so the next sign-in re-identifies
      // instead of retrying this one.
      document.cookie = `${TENANT_SLUG_COOKIE}=; path=/; max-age=0`;
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Button variant="outline" onClick={signOut} disabled={busy}>
      {busy ? "Signing out..." : "Sign out"}
    </Button>
  );
}
