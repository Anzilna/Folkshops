import { apiFetch, errorMessage } from "./api";

export interface AuditRow {
  id: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  tenantId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TenantDetail {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "suspended";
    suspendedAt: string | null;
    suspensionReason: string | null;
    createdAt: string;
  };
  subscription: {
    status: "incomplete" | "active" | "past_due" | "canceled";
    currentPeriodEnd: string | null;
    planName: string;
    planSlug: string;
    priceCents: number;
    currency: string;
    aiAccess: boolean;
    maxProducts: number | null;
  } | null;
  owners: { id: string; name: string; email: string }[];
  usage: { products: number; customers: number; orders: number; paidOrders: number; paidRevenueCents: number };
  payments: { live: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; activatedAt: string | null } | null;
  history: AuditRow[];
}

export interface ActivityItem {
  id: string;
  kind: "store" | "billing" | "security";
  title: string;
  body: string;
  at: string;
  href?: string;
}

async function ok<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(await errorMessage(res, fallback));
  return res.json();
}

export async function fetchTenantDetail(id: string): Promise<TenantDetail> {
  return ok(await apiFetch(`/platform-admin/tenants/${id}`), "Couldn't load this store");
}

export async function suspendTenant(id: string, reason: string): Promise<void> {
  await ok(await apiFetch(`/platform-admin/tenants/${id}/suspend`, { method: "POST", body: JSON.stringify({ reason }) }), "Couldn't suspend this store");
}

export async function reactivateTenant(id: string): Promise<void> {
  await ok(await apiFetch(`/platform-admin/tenants/${id}/reactivate`, { method: "POST" }), "Couldn't reactivate this store");
}

export async function fetchActivity(limit = 20): Promise<ActivityItem[]> {
  return ok(await apiFetch(`/platform-admin/activity?limit=${limit}`), "Couldn't load activity");
}

export async function createAdmin(input: { email: string; name: string; password: string }): Promise<void> {
  await ok(await apiFetch("/platform-admin/admins", { method: "POST", body: JSON.stringify(input) }), "Couldn't add this admin");
}

export async function removeAdmin(id: string): Promise<void> {
  await ok(await apiFetch(`/platform-admin/admins/${id}`, { method: "DELETE" }), "Couldn't remove this admin");
}

export async function changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
  await ok(await apiFetch("/platform-admin/auth/change-password", { method: "POST", body: JSON.stringify(input) }), "Couldn't change the password");
}

/** Who is signed in — the team page needs the id to stop you removing yourself. */
export async function fetchCurrentAdmin(): Promise<{ sub: string; email: string }> {
  const body = await ok<{ admin: { sub: string; email: string } }>(await apiFetch("/platform-admin/auth/me"), "Couldn't load your account");
  return body.admin;
}
