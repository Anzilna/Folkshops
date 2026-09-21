/** Customer-side "get one order" — see get-order.query.ts's comment on
 * why this is a distinct class from the staff-side GetOrderQuery.
 * Ownership checking (does this order belong to this customer?) stays in
 * StorefrontOrdersController, unchanged — that's authorization, not a
 * query concern. */
export class GetCustomerOrderQuery {
  constructor(
    public readonly tenantId: string,
    public readonly id: string,
  ) {}
}
