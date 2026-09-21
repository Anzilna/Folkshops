import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { OrdersService } from "../orders.service";
import { ListCustomerOrdersQuery } from "./list-customer-orders.query";

/** Registered ONLY in StorefrontOrdersModule (customer). */
@QueryHandler(ListCustomerOrdersQuery)
export class ListCustomerOrdersHandler implements IQueryHandler<ListCustomerOrdersQuery> {
  constructor(private readonly orders: OrdersService) {}

  execute(query: ListCustomerOrdersQuery) {
    return this.orders.listForCustomer(query.tenantId, query.customerId);
  }
}
