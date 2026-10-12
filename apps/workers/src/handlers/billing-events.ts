import type { BillingUpdateKind } from "@folkshops/emails";
import { withTenantContext } from "../db";
import { enqueueEmail } from "../email-queue";
import { env } from "../env";
import { getStaffRecipients } from "./staff-recipients";

const SUBSCRIPTION_EVENT_KIND: Record<string, BillingUpdateKind> = {
  "subscription.activated": "activated",
  "subscription.past_due": "past_due",
  "subscription.canceled": "canceled",
};

/**
 * subscription.activated / .past_due / .canceled -> "billing-update" email
 * to the store's owners. core-api only writes these on a real status
 * change (SubscriptionsService.lockStatus()), so Stripe's webhook retries
 * don't turn into repeat emails.
 */
export async function handleSubscriptionEvent(tenantId: string, payload: Record<string, unknown>, outboxId: string, eventType: string): Promise<void> {
  const kind = SUBSCRIPTION_EVENT_KIND[eventType];
  if (!kind) throw new Error(`Unknown subscription event "${eventType}"`);
  const planId = payload.planId;
  if (typeof planId !== "string") throw new Error(`${eventType} payload missing planId: ${JSON.stringify(payload)}`);

  const data = await withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query<{ store_name: string; plan_name: string; price_cents: number; currency: string }>(
      "SELECT t.name AS store_name, p.name AS plan_name, p.price_cents, p.currency FROM tenants t, plans p WHERE t.id = $1 AND p.id = $2",
      [tenantId, planId],
    );
    return { info: rows[0] ?? null, owners: await getStaffRecipients(client, { ownersOnly: true }) };
  });
  if (!data.info) {
    console.warn(`[${eventType}] tenant ${tenantId} / plan ${planId} not found — skipping`);
    return;
  }

  for (const owner of data.owners) {
    await enqueueEmail(`${outboxId}-billing-${owner.userId}`, {
      to: owner.email,
      template: "billing-update",
      props: {
        kind,
        storeName: data.info.store_name,
        planName: data.info.plan_name,
        priceCents: data.info.price_cents,
        currency: data.info.currency,
        billingUrl: `${env.merchantAdminUrl}/settings/billing`,
      },
    });
  }
}

/** payments.activated -> "payments-live" email to owners. Written once per store, on the first refresh that sees chargesEnabled (PaymentAccountsService.refreshStatus()). */
export async function handlePaymentsActivated(tenantId: string, _payload: Record<string, unknown>, outboxId: string): Promise<void> {
  const data = await withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query<{ name: string; slug: string }>("SELECT name, slug FROM tenants WHERE id = $1", [tenantId]);
    return { store: rows[0] ?? null, owners: await getStaffRecipients(client, { ownersOnly: true }) };
  });
  if (!data.store) return;

  for (const owner of data.owners) {
    await enqueueEmail(`${outboxId}-payments-live-${owner.userId}`, {
      to: owner.email,
      template: "payments-live",
      props: {
        storeName: data.store.name,
        storefrontUrl: env.storefrontUrlTemplate.replace("{slug}", data.store.slug),
        dashboardUrl: env.merchantAdminUrl,
      },
    });
  }
}
