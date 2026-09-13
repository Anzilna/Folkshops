import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { API_URL } from "../../lib/api";
import { DashboardShell } from "./dashboard-shell";

interface MeResponse {
  admin: { email: string };
}

/**
 * The real auth check, once, for every page under this route group — see
 * merchant-admin's identical layout.tsx for the full reasoning. The only
 * difference here: no tenant slug to forward, platform admins are global.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();

  const res = await fetch(`${API_URL}/platform-admin/auth/me`, {
    headers: { Cookie: cookieStore.toString() },
    cache: "no-store",
  });

  if (!res.ok) {
    redirect("/login");
  }

  const { admin }: MeResponse = await res.json();

  return <DashboardShell adminEmail={admin.email}>{children}</DashboardShell>;
}
