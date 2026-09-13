"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";

export function LogoutButton() {
  const router = useRouter();

  async function onClick() {
    await apiFetch("/platform-admin/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
    >
      Log out
    </button>
  );
}
