import type { DateRangeDto } from "../dto/date-range.dto";

/** Delegates to AnalyticsService.revenue() — the tenantId here always
 * comes from @CurrentTenant() (a verified staff JWT claim), never a
 * query param the caller supplied. See AnalyticsController. */
export class GetRevenueQuery {
  constructor(
    public readonly tenantId: string,
    public readonly range: DateRangeDto,
  ) {}
}
