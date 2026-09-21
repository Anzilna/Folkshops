import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { AnalyticsService } from "../analytics.service";
import { GetTopProductsQuery } from "./get-top-products.query";

@QueryHandler(GetTopProductsQuery)
export class GetTopProductsHandler implements IQueryHandler<GetTopProductsQuery> {
  constructor(private readonly analytics: AnalyticsService) {}

  execute(query: GetTopProductsQuery) {
    return this.analytics.topProducts(query.tenantId, query.range);
  }
}
