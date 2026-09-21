import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { OrdersService } from "../orders.service";
import { ListOrdersQuery } from "./list-orders.query";

/** Registered ONLY in OrdersModule (staff). */
@QueryHandler(ListOrdersQuery)
export class ListOrdersHandler implements IQueryHandler<ListOrdersQuery> {
  constructor(private readonly orders: OrdersService) {}

  execute(query: ListOrdersQuery) {
    return this.orders.listForTenant(query.tenantId, query.query);
  }
}
