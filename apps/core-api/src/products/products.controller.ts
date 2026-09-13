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
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { ImportRowsDto } from "../common/dto/import-rows.dto";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { CreateProductDto } from "./dto/create-product.dto";
import { QueryProductsDto } from "./dto/query-products.dto";
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
  async list(@Query() query: QueryProductsDto, @CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    return this.products.list(tenant.id, query);
  }

  // Declared before ":id" — Nest/Express match routes in registration
  // order, so "export" would otherwise be swallowed by ":id" and never
  // reached. Staff-only (unlike list/findOne): a CSV of every product,
  // including draft ones a storefront visitor shouldn't see, is a
  // management action, not catalog browsing.
  @Get("export")
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async exportCsv(@Query() query: QueryProductsDto, @CurrentTenant() tenant: TenantContext, @Res() res: Response) {
    const csv = await this.products.exportCsv(tenant.id, query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="products-${tenant.slug}.csv"`);
    res.send(csv);
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

  @Post("import")
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  importRows(@Body() dto: ImportRowsDto, @CurrentTenant() tenant: TenantContext) {
    return this.products.importRows(tenant.id, dto.rows);
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
