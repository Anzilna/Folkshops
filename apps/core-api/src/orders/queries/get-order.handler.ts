import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { OrdersService } from "../orders.service";
import { GetOrderQuery } from "./get-order.query";

/** Registered ONLY in OrdersModule (staff) — see get-order.query.ts's own
 * comment on why this isn't shared with the customer-side equivalent. */
@QueryHandler(GetOrderQuery)
export class GetOrderHandler implements IQueryHandler<GetOrderQuery> {
  constructor(private readonly orders: OrdersService) {}

  execute(query: GetOrderQuery) {
    return this.orders.findById(query.tenantId, query.id);
  }
}
