import { descriptionToPlainText } from "./description-to-text";

/**
 * What an MCP tool is allowed to hand to an LLM. Every tool returns one of
 * these projections, never a raw Drizzle row: a row would carry deletedAt,
 * tenantId, whatsapp opt-in timestamps and whatever column is added next,
 * all of which would reach the model (and its vendor) by default. Adding a
 * field here is a deliberate, reviewable decision.
 *
 * Money stays integer cents plus a currency code — the model formats it,
 * nothing here ever does float arithmetic on a price.
 */
export const CURRENCY = "AED";
const DESCRIPTION_MAX_CHARS = 1000;

interface ProductRow {
  id: string;
  name: string;
  priceCents: number;
  status: string;
  isActive: boolean;
  categoryId: string | null;
  description?: string | null;
  slug?: string;
  imageUrl?: string | null;
  updatedAt?: Date;
}

export function productSummary(p: ProductRow) {
  return { id: p.id, name: p.name, price_cents: p.priceCents, currency: CURRENCY, status: p.status, is_active: p.isActive };
}

export function productDetail(p: ProductRow) {
  const text = descriptionToPlainText(p.description ?? null);
  return {
    ...productSummary(p),
    slug: p.slug,
    category_id: p.categoryId,
    description: text && text.length > DESCRIPTION_MAX_CHARS ? `${text.slice(0, DESCRIPTION_MAX_CHARS)}…` : text,
    has_image: Boolean(p.imageUrl),
    updated_at: p.updatedAt?.toISOString(),
  };
}

/** Shoppers don't need (and shouldn't infer anything from) status/is_active — they only ever see active products. */
export function shopperProduct(p: ProductRow) {
  const detail = productDetail(p);
  return {
    id: detail.id,
    name: detail.name,
    price_cents: detail.price_cents,
    currency: detail.currency,
    slug: detail.slug,
    category_id: detail.category_id,
    description: detail.description,
    has_image: detail.has_image,
  };
}

export function shopperProductSummary(p: ProductRow) {
  return { id: p.id, name: p.name, price_cents: p.priceCents, currency: CURRENCY };
}

export interface OrderRow {
  id: string;
  status: string;
  subtotalCents: number;
  createdAt: Date;
  customerId: string;
}

interface OrderItemRow {
  productId: string;
  productName: string;
  priceCents: number;
  quantity: number;
}

export function orderSummary(o: OrderRow, opts: { includeCustomer: boolean }) {
  return {
    id: o.id,
    status: o.status,
    subtotal_cents: o.subtotalCents,
    currency: CURRENCY,
    created_at: o.createdAt.toISOString(),
    ...(opts.includeCustomer ? { customer_id: o.customerId } : {}),
  };
}

export function orderDetail(o: OrderRow & { items: OrderItemRow[] }, opts: { includeCustomer: boolean }) {
  return {
    ...orderSummary(o, opts),
    items: o.items.map((i) => ({
      product_id: i.productId,
      product_name: i.productName,
      unit_price_cents: i.priceCents,
      quantity: i.quantity,
      line_total_cents: i.priceCents * i.quantity,
    })),
  };
}

/** +971501234567 -> +971•••••4567. Enough for a merchant to recognise a customer, not enough to contact them through the model. */
export function maskPhone(phone: string): string {
  if (phone.length <= 8) return "•".repeat(phone.length);
  return `${phone.slice(0, 4)}${"•".repeat(phone.length - 8)}${phone.slice(-4)}`;
}

export function customerSummary(c: { id: string; name: string | null; phone: string; isActive: boolean; createdAt: Date }) {
  return { id: c.id, name: c.name, phone_masked: maskPhone(c.phone), is_active: c.isActive, created_at: c.createdAt.toISOString() };
}

export function inventoryRow(r: { productId: string; productName?: string; quantity: number; isActive: boolean }) {
  return { product_id: r.productId, product_name: r.productName, quantity: r.quantity, is_active: r.isActive };
}

export function cartView(cart: {
  items: { productId: string; name: string; quantity: number; priceCents: number; lineTotalCents: number }[];
  subtotalCents: number;
}) {
  return {
    items: cart.items.map((i) => ({
      product_id: i.productId,
      name: i.name,
      quantity: i.quantity,
      unit_price_cents: i.priceCents,
      line_total_cents: i.lineTotalCents,
    })),
    subtotal_cents: cart.subtotalCents,
    currency: CURRENCY,
  };
}
