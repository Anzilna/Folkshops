import { CommandHandler, ICommandHandler } from "@nestjs/cqrs";
import { ProductsService } from "../products.service";
import { UpdateProductCommand } from "./update-product.command";

@CommandHandler(UpdateProductCommand)
export class UpdateProductHandler implements ICommandHandler<UpdateProductCommand> {
  constructor(private readonly products: ProductsService) {}

  execute(command: UpdateProductCommand) {
    return this.products.update(command.tenantId, command.id, command.dto);
  }
}
