import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { API_URL, TENANT_SLUG_COOKIE } from "../../lib/api";
import { DashboardShell } from "./dashboard-shell";

interface MeResponse {
  user: { email: string; role: string };
  tenant: { name: string; slug: string };
}

/**
 * The real auth check lives here, once, for every page under this route
 * group — not duplicated per-page. Forwards the incoming request's cookies
 * to core-api's /auth/me, which verifies the JWT signature/expiry; an
 * expired or forged cookie gets a 401 here and is bounced to /login before
 * any page in this group renders.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const tenantSlug = cookieStore.get(TENANT_SLUG_COOKIE)?.value;

  const res = await fetch(`${API_URL}/auth/me`, {
    headers: {
      Cookie: cookieHeader,
      ...(tenantSlug ? { "X-Tenant-Id": tenantSlug } : {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    redirect("/login");
  }

  const { user, tenant }: MeResponse = await res.json();

  return (
    <DashboardShell tenantName={tenant.name} userEmail={user.email}>
      {children}
    </DashboardShell>
  );
}
