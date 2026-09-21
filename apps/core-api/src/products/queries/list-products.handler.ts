import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { ProductsService } from "../products.service";
import { ListProductsQuery } from "./list-products.query";

/** Thin — ProductsService.list()'s cache-aside/tag-invalidation/
 * pagination logic is untouched, just called through the bus. */
@QueryHandler(ListProductsQuery)
export class ListProductsHandler implements IQueryHandler<ListProductsQuery> {
  constructor(private readonly products: ProductsService) {}

  execute(query: ListProductsQuery) {
    return this.products.list(query.tenantId, query.query);
  }
}
