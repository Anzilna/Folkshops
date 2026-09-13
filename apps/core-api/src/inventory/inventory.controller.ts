import { Body, Controller, Get, NotFoundException, Param, Patch, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";
import { InventoryService } from "./inventory.service";

// Every route here requires an authenticated tenant member — no public
// read, see InventoryService for why.
@Controller("inventory")
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.inventory.list(tenant.id);
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
