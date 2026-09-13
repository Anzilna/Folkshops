import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/**
 * Shared query shape for every paginated list endpoint (products,
 * categories, inventory, customers, orders, platform-admin tenants) — one
 * DTO so the frontend's reusable table component always talks the same
 * query-string contract regardless of which resource it's pointed at.
 * Resource-specific filters (status, categoryId, ...) are added by
 * extending this class per module, not by growing this one — see
 * products/dto/query-products.dto.ts for the pattern.
 *
 * Query-string values arrive as strings; @Transform converts page/limit to
 * numbers before class-validator's @IsInt runs. This only works because
 * the global ValidationPipe has transform:true (see main.ts).
 */
export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** Column name to sort by — each service validates this against its own
   * allowlist and falls back to a default rather than trusting it as a
   * raw identifier (never interpolated into SQL either way; see
   * pagination.util.ts's resolveSort). */
  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortDir?: "asc" | "desc" = "asc";

  /** Free-text search — each service decides which column(s) this
   * ILIKE-matches against. */
  @IsOptional()
  @IsString()
  search?: string;
}
