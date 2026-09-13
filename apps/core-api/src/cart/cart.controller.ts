import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentCustomer } from "../storefront/decorators/current-customer.decorator";
import type { CustomerJwtPayload } from "../storefront/customer-auth.service";
import { CustomerJwtAuthGuard } from "../storefront/guards/customer-jwt-auth.guard";
import { CustomerTenantMatchGuard } from "../storefront/guards/customer-tenant-match.guard";
import { CartService } from "./cart.service";
import { AddCartItemDto } from "./dto/add-cart-item.dto";
import { UpdateCartItemDto } from "./dto/update-cart-item.dto";

// Every route requires a logged-in customer — no guest cart, see
// carts.ts schema comment for why.
@Controller("storefront/cart")
@UseGuards(CustomerJwtAuthGuard, CustomerTenantMatchGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  getCart(@CurrentCustomer() customer: CustomerJwtPayload) {
    return this.cart.getCart(customer.tenantId, customer.sub);
  }

  @Post("items")
  addItem(@Body() dto: AddCartItemDto, @CurrentCustomer() customer: CustomerJwtPayload) {
    return this.cart.addItem(customer.tenantId, customer.sub, dto.productId, dto.quantity);
  }

  @Patch("items/:productId")
  updateItem(
    @Param("productId") productId: string,
    @Body() dto: UpdateCartItemDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
  ) {
    return this.cart.updateItemQuantity(customer.tenantId, customer.sub, productId, dto.quantity);
  }

  @Delete("items/:productId")
  removeItem(@Param("productId") productId: string, @CurrentCustomer() customer: CustomerJwtPayload) {
    return this.cart.removeItem(customer.tenantId, customer.sub, productId);
  }
}
