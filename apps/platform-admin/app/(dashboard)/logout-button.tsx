"use client";

import { Button } from "@folkshops/ui";
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
    <Button variant="outline" size="sm" onClick={onClick} className="w-full">
      Log out
    </Button>
  );
}
