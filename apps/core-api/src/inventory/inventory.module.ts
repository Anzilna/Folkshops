import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

@Module({
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  // Exported for the MCP tools (src/mcp/) — same service, not a second copy.
  exports: [InventoryService],
})
export class InventoryModule {}
