import { Module } from "@nestjs/common";
import { CartModule } from "../cart/cart.module";
import { StorefrontModule } from "../storefront/storefront.module";
import { TenantsModule } from "../tenants/tenants.module";
import { CustomerMcpController } from "./customer-mcp.controller";
import { CustomerMcpGuard } from "./guards/customer-mcp.guard";
import { InternalServiceGuard } from "./guards/internal-service.guard";

/** Customer-surface MCP only — see StaffMcpModule for why the two are never one module. */
@Module({
  imports: [StorefrontModule, TenantsModule, CartModule],
  controllers: [CustomerMcpController],
  providers: [InternalServiceGuard, CustomerMcpGuard],
})
export class CustomerMcpModule {}
