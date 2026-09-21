import type { DateRangeDto } from "../dto/date-range.dto";

export class GetTopProductsQuery {
  constructor(
    public readonly tenantId: string,
    public readonly range: DateRangeDto,
  ) {}
}
