import type { QueryOrdersDto } from "../dto/query-orders.dto";

/** Staff-side listing — see get-order.query.ts's comment on why this is a
 * distinct class from ListCustomerOrdersQuery. */
export class ListOrdersQuery {
  constructor(
    public readonly tenantId: string,
    public readonly query: QueryOrdersDto,
  ) {}
}
