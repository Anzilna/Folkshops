import type { PoolClient } from "pg";

export interface WhatsAppContact {
  phone: string;
  name: string | null;
}

/**
 * The order's customer, only if they've opted in to WhatsApp updates and
 * are still an active, non-deleted customer — null means "don't message".
 * Must run inside withTenantContext (customers/orders are RLS-protected).
 * The opt-in check lives here, at send time, not at enqueue-decision time
 * elsewhere, so an opt-out always wins over an already-written outbox row.
 */
export async function getWhatsAppContactForOrder(client: PoolClient, orderId: string): Promise<WhatsAppContact | null> {
  const { rows } = await client.query<{ phone: string; name: string | null }>(
    `SELECT c.phone, c.name FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = $1 AND c.whatsapp_opt_in AND c.is_active AND c.deleted_at IS NULL`,
    [orderId],
  );
  return rows[0] ?? null;
}
