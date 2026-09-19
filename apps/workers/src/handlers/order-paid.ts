import type { PoolClient } from "pg";
import { withTenantContext } from "../db";

/**
 * The one job handler that exists so far — proves the outbox/BullMQ
 * pattern end-to-end with a real caller (merchant-admin's notification
 * bell, previously fed only @folkshops/ui's `demoNotifications()`). A
 * second event type (e.g. "order.payment_failed", eventually real email/
 * SMS) is a new file in this directory plus one line in worker.ts's
 * dispatch map — this file itself doesn't need to change.
 */
export async function handleOrderPaid(tenantId: string, payload: Record<string, unknown>): Promise<void> {
  const orderId = payload.orderId;
  if (typeof orderId !== "string") throw new Error(`order.paid payload missing orderId: ${JSON.stringify(payload)}`);

  await withTenantContext(tenantId, async (client: PoolClient) => {
    const { rows } = await client.query<{ id: string; subtotal_cents: number }>(
      "SELECT id, subtotal_cents FROM orders WHERE id = $1",
      [orderId],
    );
    const order = rows[0];
    if (!order) {
      // The order existed when the webhook fired (that's how this job got
      // enqueued at all) — this would mean it was deleted since, which
      // nothing in this codebase does. Logged, not thrown: retrying a job
      // that can never succeed just burns BullMQ's 3 attempts for nothing.
      console.warn(`[order.paid] order ${orderId} not found for tenant ${tenantId} — skipping`);
      return;
    }

    const amount = `AED ${(order.subtotal_cents / 100).toLocaleString("en-AE", { minimumFractionDigits: 2 })}`;
    await client.query(
      `INSERT INTO notifications (tenant_id, kind, title, body, href) VALUES ($1, 'order', $2, $3, $4)`,
      [tenantId, `New order #${order.id.slice(0, 8).toUpperCase()}`, `Paid — ${amount}.`, `/orders/${order.id}`],
    );
  });
}
