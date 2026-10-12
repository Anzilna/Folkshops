import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { PlatformAdminJwtAuthGuard } from "../guards/platform-admin-jwt-auth.guard";
import { PlatformAdminPlansService, QueryPlansDto } from "./platform-admin-plans.service";

@Controller("platform-admin/plans")
@UseGuards(PlatformAdminJwtAuthGuard)
export class PlatformAdminPlansController {
  constructor(private readonly plans: PlatformAdminPlansService) {}

  @Get()
  list(@Query() query: QueryPlansDto) {
    return this.plans.list(query);
  }
}
