import { withTenantContext } from "../db";
import { enqueueEmail } from "../email-queue";
import { env } from "../env";

/**
 * merchant.registered -> the welcome email. Written to the outbox by
 * core-api's AuthService.register() in the same transaction that creates
 * the store, so a registration that commits always gets its email, and a
 * rolled-back one never does — without core-api itself ever talking to an
 * email vendor mid-request.
 */
export async function handleMerchantRegistered(tenantId: string, payload: Record<string, unknown>, outboxId: string): Promise<void> {
  const userId = payload.userId;
  if (typeof userId !== "string") throw new Error(`merchant.registered payload missing userId: ${JSON.stringify(payload)}`);

  // users/tenants aren't RLS-protected, but going through tenant context
  // anyway keeps every handler on the same footing.
  const row = await withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query<{ email: string; name: string; store_name: string; slug: string }>(
      "SELECT u.email, u.name, t.name AS store_name, t.slug FROM users u, tenants t WHERE u.id = $1 AND t.id = $2",
      [userId, tenantId],
    );
    return rows[0] ?? null;
  });
  if (!row) {
    console.warn(`[merchant.registered] user ${userId} / tenant ${tenantId} not found — skipping`);
    return;
  }

  await enqueueEmail(`${outboxId}-welcome`, {
    to: row.email,
    template: "welcome",
    props: {
      ownerName: row.name,
      storeName: row.store_name,
      dashboardUrl: env.merchantAdminUrl,
      storefrontUrl: env.storefrontUrlTemplate.replace("{slug}", row.slug),
    },
  });
}
