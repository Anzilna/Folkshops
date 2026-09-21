import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { AnalyticsService } from "../analytics.service";
import { GetRevenueQuery } from "./get-revenue.query";

/** Thin — AnalyticsService.revenue()'s Elasticsearch aggregation
 * (term:{tenantId} + date-range filter + sum/value_count/nested-sum aggs)
 * is untouched, just called through the bus. */
@QueryHandler(GetRevenueQuery)
export class GetRevenueHandler implements IQueryHandler<GetRevenueQuery> {
  constructor(private readonly analytics: AnalyticsService) {}

  execute(query: GetRevenueQuery) {
    return this.analytics.revenue(query.tenantId, query.range);
  }
}
