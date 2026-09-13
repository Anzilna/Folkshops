import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { ImportRowsDto } from "../common/dto/import-rows.dto";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";
import { QueryInventoryDto } from "./dto/query-inventory.dto";
import { InventoryService } from "./inventory.service";

// Every route here requires an authenticated tenant member — no public
// read, see InventoryService for why.
@Controller("inventory")
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Query() query: QueryInventoryDto, @CurrentTenant() tenant: TenantContext) {
    return this.inventory.list(tenant.id, query);
  }

  // Before ":productId" — see ProductsController's exportCsv for why the order matters.
  @Get("export")
  async exportCsv(@Query() query: QueryInventoryDto, @CurrentTenant() tenant: TenantContext, @Res() res: Response) {
    const csv = await this.inventory.exportCsv(tenant.id, query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="inventory-${tenant.slug}.csv"`);
    res.send(csv);
  }

  @Post("import")
  importRows(@Body() dto: ImportRowsDto, @CurrentTenant() tenant: TenantContext) {
    return this.inventory.importRows(tenant.id, dto.rows);
  }

  @Get(":productId")
  async findOne(@Param("productId") productId: string, @CurrentTenant() tenant: TenantContext) {
    const row = await this.inventory.findByProductId(tenant.id, productId);
    if (!row) throw new NotFoundException("No inventory record for this product");
    return row;
  }

  @Patch(":productId")
  async setQuantity(
    @Param("productId") productId: string,
    @Body() dto: UpdateInventoryDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const row = await this.inventory.setQuantity(tenant.id, productId, dto.quantity);
    if (!row) throw new NotFoundException("Product not found");
    return row;
  }
}
