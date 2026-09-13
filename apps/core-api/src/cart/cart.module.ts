import { Module } from "@nestjs/common";
import { StorefrontModule } from "../storefront/storefront.module";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";

@Module({
  imports: [StorefrontModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
