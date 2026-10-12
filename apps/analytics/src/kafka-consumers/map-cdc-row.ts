import { descriptionToPlainText } from "./description-to-text";

/**
 * Debezium reports raw Postgres column names (snake_case) — these map
 * that shape onto product-search.mapping.ts/category-search.mapping.ts's
 * camelCase fields. Timestamptz columns arrive as ISO 8601 strings
 * (Debezium's ZonedTimestamp semantic type), uuid/enum/text columns as
 * plain strings, integers/booleans as their native JSON types — no
 * conversion needed beyond field renaming.
 */
interface ProductRow {
  id: string;
  tenant_id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  status: string;
  is_active: boolean;
  deleted_at: string | null;
  image_url: string | null;
  updated_at: string;
}

interface CategoryRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  deleted_at: string | null;
  updated_at: string;
}

export function mapProductRow(row: ProductRow, sourceTsMs: number) {
  return {
    productId: row.id,
    tenantId: row.tenant_id,
    categoryId: row.category_id,
    name: row.name,
    slug: row.slug,
    description: descriptionToPlainText(row.description),
    priceCents: row.price_cents,
    status: row.status,
    isActive: row.is_active,
    deletedAt: row.deleted_at,
    imageUrl: row.image_url,
    updatedAt: row.updated_at,
    lastCdcTsMs: sourceTsMs,
  };
}

export function mapCategoryRow(row: CategoryRow, sourceTsMs: number) {
  return {
    categoryId: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isActive: row.is_active,
    deletedAt: row.deleted_at,
    updatedAt: row.updated_at,
    lastCdcTsMs: sourceTsMs,
  };
}
