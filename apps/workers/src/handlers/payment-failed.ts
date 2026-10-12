import { withTenantContext } from "../db";
import { env } from "../env";
import { enqueueWhatsApp } from "../whatsapp-queue";
import { getWhatsAppContactForOrder } from "./customer-contact";

/**
 * payment.failed -> a WhatsApp nudge to the customer (opted-in only), with
 * a link to their order page, which shows "Pay now" for a payment_failed
 * order. Staff get nothing: this fires on every abandoned/expired Stripe
 * Checkout session, which is noise in a merchant's inbox or bell.
 *
 * (Before this handler existed at all, payment.failed rows failed
 * worker.ts's "No handler registered" check and were re-enqueued by the
 * relay every minute forever.)
 */
export async function handlePaymentFailed(tenantId: string, payload: Record<string, unknown>, outboxId: string): Promise<void> {
  const orderId = payload.orderId;
  if (typeof orderId !== "string") throw new Error(`payment.failed payload missing orderId: ${JSON.stringify(payload)}`);

  const result = await withTenantContext(tenantId, async (client) => {
    // Re-check status: a customer who already retried and paid by the time
    // this runs must not be told their payment failed.
    const { rows } = await client.query<{ status: string; store_name: string; store_slug: string }>(
      "SELECT o.status, t.name AS store_name, t.slug AS store_slug FROM orders o JOIN tenants t ON t.id = o.tenant_id WHERE o.id = $1",
      [orderId],
    );
    const order = rows[0];
    if (!order || order.status !== "payment_failed") return null;
    const contact = await getWhatsAppContactForOrder(client, orderId);
    return contact ? { order, contact } : null;
  });
  if (!result) return;

  await enqueueWhatsApp(`${outboxId}-payment-not-completed`, {
    to: result.contact.phone,
    template: "payment_not_completed",
    props: {
      customerName: result.contact.name,
      storeName: result.order.store_name,
      orderNumber: `#${orderId.slice(0, 8).toUpperCase()}`,
      orderUrl: `${env.storefrontUrlTemplate.replace("{slug}", result.order.store_slug)}/orders/${orderId}`,
    },
  });
}
