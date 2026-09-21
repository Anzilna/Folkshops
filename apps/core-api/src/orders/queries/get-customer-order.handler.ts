import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { OrdersService } from "../orders.service";
import { GetCustomerOrderQuery } from "./get-customer-order.query";

/** Registered ONLY in StorefrontOrdersModule (customer). */
@QueryHandler(GetCustomerOrderQuery)
export class GetCustomerOrderHandler implements IQueryHandler<GetCustomerOrderQuery> {
  constructor(private readonly orders: OrdersService) {}

  execute(query: GetCustomerOrderQuery) {
    return this.orders.findById(query.tenantId, query.id);
  }
}
