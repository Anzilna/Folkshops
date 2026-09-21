import type { CreateProductDto } from "../dto/create-product.dto";

/** Delegates to ProductsService.create() — the write transaction and
 * cache-tag invalidation stay exactly as they are. */
export class CreateProductCommand {
  constructor(
    public readonly tenantId: string,
    public readonly dto: CreateProductDto,
  ) {}
}
