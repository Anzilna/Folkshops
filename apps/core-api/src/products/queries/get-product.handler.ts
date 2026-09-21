import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { ProductsService } from "../products.service";
import { GetProductQuery } from "./get-product.query";

/**
 * Thin orchestration only — no business logic here. Every real decision
 * (strong-read consistency, no caching, soft-delete filtering) already
 * lives in ProductsService.findById() and stays there unchanged.
 */
@QueryHandler(GetProductQuery)
export class GetProductHandler implements IQueryHandler<GetProductQuery> {
  constructor(private readonly products: ProductsService) {}

  execute(query: GetProductQuery) {
    return this.products.findById(query.tenantId, query.id);
  }
}
