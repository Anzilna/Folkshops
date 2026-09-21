import type { SalesOverTimeDto } from "../dto/date-range.dto";

export class GetSalesOverTimeQuery {
  constructor(
    public readonly tenantId: string,
    public readonly query: SalesOverTimeDto,
  ) {}
}
