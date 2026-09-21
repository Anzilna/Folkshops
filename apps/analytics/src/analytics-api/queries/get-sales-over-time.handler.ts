import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { AnalyticsService } from "../analytics.service";
import { GetSalesOverTimeQuery } from "./get-sales-over-time.query";

@QueryHandler(GetSalesOverTimeQuery)
export class GetSalesOverTimeHandler implements IQueryHandler<GetSalesOverTimeQuery> {
  constructor(private readonly analytics: AnalyticsService) {}

  execute(query: GetSalesOverTimeQuery) {
    return this.analytics.salesOverTime(query.tenantId, query.query);
  }
}
