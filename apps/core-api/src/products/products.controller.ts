import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { ProductsService } from "./products.service";

@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // Read endpoints are public (no JwtAuthGuard) — anyone visiting a store's
  // subdomain can browse its catalog without an account, same as any real
  // storefront. Still tenant-scoped: TenantResolverMiddleware + RLS gate
  // what's visible, auth is a separate concern from browsing.

  @Get()
  async list(@CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    return this.products.list(tenant.id);
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    const product = await this.products.findById(tenant.id, id);
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  // Mutations require an authenticated member of the resolved tenant — any
  // role, not owner-only (RolesGuard/@Roles() stays deferred, nothing here
  // needs role restriction yet).

  @Post()
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  create(@Body() dto: CreateProductDto, @CurrentTenant() tenant: TenantContext) {
    return this.products.create(tenant.id, dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async update(@Param("id") id: string, @Body() dto: UpdateProductDto, @CurrentTenant() tenant: TenantContext) {
    const product = await this.products.update(tenant.id, id, dto);
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async remove(@Param("id") id: string, @CurrentTenant() tenant: TenantContext) {
    const product = await this.products.delete(tenant.id, id);
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }
}
