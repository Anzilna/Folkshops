import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { QueryTenantsDto } from "../../tenants/dto/query-tenants.dto";
import { TenantsService } from "../../tenants/tenants.service";
import { CurrentPlatformAdmin } from "../decorators/current-platform-admin.decorator";
import { PlatformAdminJwtAuthGuard } from "../guards/platform-admin-jwt-auth.guard";
import type { PlatformAdminJwtPayload } from "../platform-admin-auth.service";
import { PlatformAdminTenantsService } from "./platform-admin-tenants.service";
import { SuspendTenantDto } from "./suspend-tenant.dto";

// Global — no tenant scoping (platform admins see every tenant). No
// import endpoint — see TenantsService.exportCsv's comment for why.
@Controller("platform-admin/tenants")
@UseGuards(PlatformAdminJwtAuthGuard)
export class PlatformAdminTenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly platformTenants: PlatformAdminTenantsService,
  ) {}

  @Get()
  list(@Query() query: QueryTenantsDto) {
    return this.platformTenants.list(query);
  }

  // Declared before ":id" — Express matches in registration order, so
  // "export" would otherwise be swallowed by ":id".
  @Get("export")
  async exportCsv(@Query() query: QueryTenantsDto, @Res() res: Response) {
    const csv = await this.tenants.exportCsv(query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tenants.csv"`);
    res.send(csv);
  }

  @Get(":id")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.platformTenants.getDetail(id);
  }

  @Post(":id/suspend")
  suspend(@Param("id", ParseUUIDPipe) id: string, @Body() dto: SuspendTenantDto, @CurrentPlatformAdmin() admin: PlatformAdminJwtPayload) {
    return this.platformTenants.suspend(admin, id, dto.reason);
  }

  @Post(":id/reactivate")
  reactivate(@Param("id", ParseUUIDPipe) id: string, @CurrentPlatformAdmin() admin: PlatformAdminJwtPayload) {
    return this.platformTenants.reactivate(admin, id);
  }
}
