import { asc, desc, SQL } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function paginatedResult<T>(data: T[], total: number, page: number, limit: number): PaginatedResult<T> {
  return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export function offsetFor(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Turns a client-supplied sortBy string into an actual Drizzle column
 * expression — never interpolated into raw SQL, and never trusted as a
 * column name directly. `sortBy` only selects a key into `columns`; an
 * unrecognized key silently falls back to `defaultKey` rather than
 * erroring, since a stale/bookmarked table URL with a since-removed sort
 * column shouldn't break the page.
 */
export function resolveSort<K extends string>(
  sortBy: string | undefined,
  sortDir: "asc" | "desc" | undefined,
  columns: Record<K, PgColumn>,
  defaultKey: K,
): SQL {
  const key = (sortBy && Object.prototype.hasOwnProperty.call(columns, sortBy) ? sortBy : defaultKey) as K;
  const column = columns[key];
  return sortDir === "desc" ? desc(column) : asc(column);
}
