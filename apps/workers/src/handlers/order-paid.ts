import { formatMoney } from "@folkshops/emails";
import type { PoolClient } from "pg";
import { withTenantContext } from "../db";
import { enqueueEmail } from "../email-queue";
import { env } from "../env";
import { enqueueWhatsApp } from "../whatsapp-queue";
import { getWhatsAppContactForOrder } from "./customer-contact";
import { getStaffRecipients } from "./staff-recipients";

/**
 * order.paid -> merchant-admin's notification bell, a "New order" email
 * to every staff member of the store, and — if the customer opted in — an
 * order confirmation on WhatsApp. The email is only *enqueued* here
 * (see email-queue.ts for why sending lives on its own queue); the DB
 * reads/writes happen first in one tenant-scoped transaction, and the
 * enqueue after it commits, keyed per outbox row + recipient so a retry of
 * this handler can't send twice. (The bell row itself isn't deduplicated —
 * if Redis fails between the commit and the enqueue, the retry inserts a
 * second one. Same exposure the handler always had; job-handler
 * idempotency is still ADR 0007's open item.)
 */
export async function handleOrderPaid(tenantId: string, payload: Record<string, unknown>, outboxId: string): Promise<void> {
  const orderId = payload.orderId;
  if (typeof orderId !== "string") throw new Error(`order.paid payload missing orderId: ${JSON.stringify(payload)}`);
  const currency = typeof payload.currency === "string" ? payload.currency : "aed";

  const result = await withTenantContext(tenantId, async (client: PoolClient) => {
    const { rows } = await client.query<{ id: string; subtotal_cents: number; customer_name: string | null; store_name: string; store_slug: string }>(
      `SELECT o.id, o.subtotal_cents, c.name AS customer_name, t.name AS store_name, t.slug AS store_slug
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN tenants t ON t.id = o.tenant_id
       WHERE o.id = $1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) {
      // The order existed when the webhook fired (that's how this job got
      // enqueued at all) — this would mean it was deleted since, which
      // nothing in this codebase does. Logged, not thrown: retrying a job
      // that can never succeed just burns BullMQ's 3 attempts for nothing.
      console.warn(`[order.paid] order ${orderId} not found for tenant ${tenantId} — skipping`);
      return null;
    }

    const orderNumber = `#${order.id.slice(0, 8).toUpperCase()}`;
    const amount = `AED ${(order.subtotal_cents / 100).toLocaleString("en-AE", { minimumFractionDigits: 2 })}`;
    await client.query(
      `INSERT INTO notifications (tenant_id, kind, title, body, href) VALUES ($1, 'order', $2, $3, $4)`,
      [tenantId, `New order ${orderNumber}`, `Paid — ${amount}.`, `/orders/${order.id}`],
    );

    // order_items, not the payload's own `items` copy — outbox rows written
    // before docs/decisions/0009 enriched the payload don't carry it.
    const { rows: items } = await client.query<{ product_name: string; quantity: number; price_cents: number }>(
      "SELECT product_name, quantity, price_cents FROM order_items WHERE order_id = $1 ORDER BY created_at",
      [orderId],
    );
    const recipients = await getStaffRecipients(client);
    const whatsappContact = await getWhatsAppContactForOrder(client, orderId);
    return { order, orderNumber, items, recipients, whatsappContact };
  });
  if (!result) return;

  const { order, orderNumber, items, recipients, whatsappContact } = result;
  if (whatsappContact) {
    await enqueueWhatsApp(`${outboxId}-order-confirmed`, {
      to: whatsappContact.phone,
      template: "order_confirmed",
      props: {
        customerName: whatsappContact.name,
        storeName: order.store_name,
        orderNumber,
        total: formatMoney(order.subtotal_cents, currency),
        orderUrl: `${env.storefrontUrlTemplate.replace("{slug}", order.store_slug)}/orders/${order.id}`,
      },
    });
  }
  for (const recipient of recipients) {
    await enqueueEmail(`${outboxId}-new-order-${recipient.userId}`, {
      to: recipient.email,
      template: "new-order",
      props: {
        storeName: order.store_name,
        orderNumber,
        orderUrl: `${env.merchantAdminUrl}/orders/${order.id}`,
        customerName: order.customer_name,
        currency,
        subtotalCents: order.subtotal_cents,
        items: items.map((i) => ({ productName: i.product_name, quantity: i.quantity, priceCents: i.price_cents })),
      },
    });
  }
}
