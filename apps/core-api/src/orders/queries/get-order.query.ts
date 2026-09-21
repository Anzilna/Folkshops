/**
 * Staff-side "get one order" — deliberately a DISTINCT class from
 * GetCustomerOrderQuery even though both delegate to the same
 * OrdersService.findById(). CommandBus/QueryBus are global singletons
 * keyed by class, and OrdersService is intentionally provided as two
 * separate DI instances (OrdersModule vs StorefrontOrdersModule, to avoid
 * CLAUDE.md bug #7's JwtModule collision) — sharing one Query class
 * registered in both modules would let the second module's handler
 * silently overwrite the first in the bus's handler map at boot. See
 * docs/decisions/0010-partial-cqrs-migration.md.
 */
export class GetOrderQuery {
  constructor(
    public readonly tenantId: string,
    public readonly id: string,
  ) {}
}
