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
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

// Same public-read/authenticated-write split as ProductsController — a
// storefront visitor browsing by category needs no account, mutating the
// category list needs any authenticated member of the tenant (no
// owner-only restriction — RolesGuard/@Roles() stays deferred).
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  async list(@CurrentTenant() tenant?: TenantContext) {
    if (!tenant) throw new BadRequestException("No store resolved for this request");
    return this.categories.list(tenant.id);
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
