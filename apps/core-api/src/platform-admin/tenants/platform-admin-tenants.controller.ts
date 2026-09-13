import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { QueryTenantsDto } from "../../tenants/dto/query-tenants.dto";
import { TenantsService } from "../../tenants/tenants.service";
import { PlatformAdminJwtAuthGuard } from "../guards/platform-admin-jwt-auth.guard";

// Global — no tenant scoping (platform admins see every tenant). No
// import endpoint — see TenantsService.exportCsv's comment for why.
@Controller("platform-admin/tenants")
@UseGuards(PlatformAdminJwtAuthGuard)
export class PlatformAdminTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list(@Query() query: QueryTenantsDto) {
    return this.tenants.list(query);
  }

  @Get("export")
  async exportCsv(@Query() query: QueryTenantsDto, @Res() res: Response) {
    const csv = await this.tenants.exportCsv(query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tenants.csv"`);
    res.send(csv);
  }
}
