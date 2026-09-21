import { CommandHandler, ICommandHandler } from "@nestjs/cqrs";
import { ProductsService } from "../products.service";
import { CreateProductCommand } from "./create-product.command";

/** Thin — no duplicated business logic. ProductsService.create() still
 * owns the dbRouter.write() transaction and the tenant-wide cache-tag
 * invalidation that follows it. */
@CommandHandler(CreateProductCommand)
export class CreateProductHandler implements ICommandHandler<CreateProductCommand> {
  constructor(private readonly products: ProductsService) {}

  execute(command: CreateProductCommand) {
    return this.products.create(command.tenantId, command.dto);
  }
}
