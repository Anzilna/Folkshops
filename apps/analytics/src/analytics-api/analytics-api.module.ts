import { Module } from "@nestjs/common";
import { SearchModule } from "../search/search.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { GetRevenueHandler } from "./queries/get-revenue.handler";
import { GetSalesOverTimeHandler } from "./queries/get-sales-over-time.handler";
import { GetTopProductsHandler } from "./queries/get-top-products.handler";

@Module({
  imports: [SearchModule],
  controllers: [AnalyticsController],
  // GetRevenueHandler/GetTopProductsHandler/GetSalesOverTimeHandler
  // registered here — orders()/productPerformance() stay direct
  // AnalyticsService calls, no query was introduced for them in this
  // pass (see docs/decisions/0010-partial-cqrs-migration.md). CqrsModule
  // is imported once, globally, in AppModule.
  providers: [AnalyticsService, GetRevenueHandler, GetTopProductsHandler, GetSalesOverTimeHandler],
})
export class AnalyticsApiModule {}
