/** Thin data holder — no logic. Delegates to ProductsService.findById(),
 * which keeps its existing "strong", deliberately-uncached read (see that
 * method's own comment) unchanged. */
export class GetProductQuery {
  constructor(
    public readonly tenantId: string,
    public readonly id: string,
  ) {}
}
