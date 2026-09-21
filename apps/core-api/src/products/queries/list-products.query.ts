import type { QueryProductsDto } from "../dto/query-products.dto";

/** Delegates to ProductsService.list() — the existing cache-aside,
 * "eventual"-consistency read stays exactly as it is. */
export class ListProductsQuery {
  constructor(
    public readonly tenantId: string,
    public readonly query: QueryProductsDto,
  ) {}
}
