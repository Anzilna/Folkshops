import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CustomersModule } from "../customers/customers.module";
import { InventoryModule } from "../inventory/inventory.module";
import { TenantsModule } from "../tenants/tenants.module";
import { InternalServiceGuard } from "./guards/internal-service.guard";
import { StaffMcpGuard } from "./guards/staff-mcp.guard";
import { StaffMcpController } from "./staff-mcp.controller";

/**
 * Staff-surface MCP only — deliberately separate from CustomerMcpModule.
 * Importing both AuthModule and StorefrontModule into one module would put
 * two JwtService registrations in scope and Nest would silently pick one
 * for every guard (CLAUDE.md bug #7). Every import here is on the staff
 * side (AuthModule's JwtModule). Products/orders go through the global
 * CommandBus/QueryBus, so their modules aren't imported.
 */
@Module({
  imports: [AuthModule, TenantsModule, InventoryModule, CustomersModule],
  controllers: [StaffMcpController],
  providers: [InternalServiceGuard, StaffMcpGuard],
})
export class StaffMcpModule {}
