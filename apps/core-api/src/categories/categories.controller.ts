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
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { QueryCategoriesDto } from "./dto/query-categories.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

// Same public-read/authenticated-write split as ProductsController — a
// storefront visitor browsing by category needs no account, mutating the
// category list needs any authenticated member of the tenant (no
// owner-only restriction — RolesGuard/@Roles() stays deferred).
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  async list(@Query() query: QueryCategoriesDto, @CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    return this.categories.list(tenant.id, query);
  }

  // Before ":id" — see ProductsController's exportCsv for why the order matters.
  @Get("export")
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async exportCsv(@Query() query: QueryCategoriesDto, @CurrentTenant() tenant: TenantContext, @Res() res: Response) {
    const csv = await this.categories.exportCsv(tenant.id, query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="categories-${tenant.slug}.csv"`);
    res.send(csv);
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    const category = await this.categories.findById(tenant.id, id);
    if (!category) throw new NotFoundException("Category not found");
    return category;
  }

  @Post()
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  create(@Body() dto: CreateCategoryDto, @CurrentTenant() tenant: TenantContext) {
    return this.categories.create(tenant.id, dto);
  }

  @Post("import")
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  importRows(@Body() dto: ImportRowsDto, @CurrentTenant() tenant: TenantContext) {
    return this.categories.importRows(tenant.id, dto.rows);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async update(@Param("id") id: string, @Body() dto: UpdateCategoryDto, @CurrentTenant() tenant: TenantContext) {
    const category = await this.categories.update(tenant.id, id, dto);
    if (!category) throw new NotFoundException("Category not found");
    return category;
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async remove(@Param("id") id: string, @CurrentTenant() tenant: TenantContext) {
    const category = await this.categories.delete(tenant.id, id);
    if (!category) throw new NotFoundException("Category not found");
    return category;
  }
}
