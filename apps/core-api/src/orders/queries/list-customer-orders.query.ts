/** Customer-side listing — see get-order.query.ts's comment on why this is
 * a distinct class from the staff-side ListOrdersQuery. */
export class ListCustomerOrdersQuery {
  constructor(
    public readonly tenantId: string,
    public readonly customerId: string,
  ) {}
}
