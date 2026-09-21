import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CreateProductHandler } from "./commands/create-product.handler";
import { UpdateProductHandler } from "./commands/update-product.handler";
import { GetProductHandler } from "./queries/get-product.handler";
import { ListProductsHandler } from "./queries/list-products.handler";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";

@Module({
  imports: [AuthModule],
  controllers: [ProductsController],
  // CommandBus/QueryBus come from CqrsModule (registered globally in
  // AppModule) — these four handlers must still be listed here explicitly
  // to be discovered at boot. export()/import() (bulk CSV) and remove()
  // (soft-delete) stay direct ProductsService calls — no command was
  // introduced for them in this pass, see docs/decisions/0010.
  providers: [ProductsService, CreateProductHandler, UpdateProductHandler, GetProductHandler, ListProductsHandler],
})
export class ProductsModule {}
