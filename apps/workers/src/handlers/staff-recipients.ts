import type { PoolClient } from "pg";

export interface StaffRecipient {
  userId: string;
  email: string;
  name: string;
}

/**
 * Everyone with a membership in the current tenant — must run inside
 * withTenantContext, since memberships is RLS-protected (that's what
 * scopes this to one store, not a WHERE clause). Every member, not just
 * owners: today one email = one store = one owner anyway, and once staff
 * invitations exist a per-member opt-out is the natural next knob, not a
 * role filter here.
 */
export async function getStaffRecipients(client: PoolClient, opts: { ownersOnly?: boolean } = {}): Promise<StaffRecipient[]> {
  // ownersOnly: billing/payments-account mail — decisions only the
  // store's owner can act on (merchant-admin's billing pages are theirs).
  const { rows } = await client.query<{ user_id: string; email: string; name: string }>(
    `SELECT u.id AS user_id, u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id${opts.ownersOnly ? " WHERE m.role = 'owner'" : ""}`,
  );
  return rows.map((r) => ({ userId: r.user_id, email: r.email, name: r.name }));
}
