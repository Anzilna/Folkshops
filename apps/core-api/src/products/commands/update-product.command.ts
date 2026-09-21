import type { UpdateProductDto } from "../dto/update-product.dto";

/** Delegates to ProductsService.update() — the write transaction and the
 * both-tags cache invalidation (per-product + tenant-wide, see that
 * method's own comment on why it can't invalidate narrowly) stay as-is. */
export class UpdateProductCommand {
  constructor(
    public readonly tenantId: string,
    public readonly id: string,
    public readonly dto: UpdateProductDto,
  ) {}
}
