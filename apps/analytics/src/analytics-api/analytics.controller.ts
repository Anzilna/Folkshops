import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { CurrentTenant } from "../auth/current-tenant.decorator";
import { StaffJwtGuard } from "../auth/staff-jwt.guard";
import { AnalyticsService } from "./analytics.service";
import { DateRangeDto, SalesOverTimeDto } from "./dto/date-range.dto";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { GetRevenueQuery } from "./queries/get-revenue.query";
import { GetSalesOverTimeQuery } from "./queries/get-sales-over-time.query";
import { GetTopProductsQuery } from "./queries/get-top-products.query";

/**
 * Tenant is resolved EXCLUSIVELY via @CurrentTenant() (the tenantId claim
 * off a verified staff JWT) — no endpoint here accepts or trusts a
 * tenantId query param. See docs/decisions/0009 and
 * auth/current-tenant.decorator.ts.
 */
@UseGuards(StaffJwtGuard)
@Controller("analytics")
export class AnalyticsController {
  // AnalyticsService still injected directly — orders()/productPerformance()
  // below are unchanged, no query was introduced for them in this pass
  // (see docs/decisions/0010-partial-cqrs-migration.md).
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly queryBus: QueryBus,
  ) {}

  @Get("revenue")
  revenue(@CurrentTenant() tenantId: string, @Query() query: DateRangeDto) {
    return this.queryBus.execute(new GetRevenueQuery(tenantId, query));
  }

  @Get("orders")
  orders(@CurrentTenant() tenantId: string, @Query() query: PaginationQueryDto) {
    return this.analytics.orders(tenantId, query);
  }

  @Get("top-products")
  topProducts(@CurrentTenant() tenantId: string, @Query() query: DateRangeDto) {
    return this.queryBus.execute(new GetTopProductsQuery(tenantId, query));
  }

  @Get("sales-over-time")
  salesOverTime(@CurrentTenant() tenantId: string, @Query() query: SalesOverTimeDto) {
    return this.queryBus.execute(new GetSalesOverTimeQuery(tenantId, query));
  }

  @Get("product-performance")
  productPerformance(@CurrentTenant() tenantId: string, @Query() query: PaginationQueryDto) {
    return this.analytics.productPerformance(tenantId, query);
  }
}
