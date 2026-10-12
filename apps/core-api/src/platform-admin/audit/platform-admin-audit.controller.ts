import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { PlatformAdminJwtAuthGuard } from "../guards/platform-admin-jwt-auth.guard";
import { PlatformAuditService } from "./platform-audit.service";
import { QueryAuditLogDto } from "./query-audit-log.dto";

@Controller("platform-admin/audit-log")
@UseGuards(PlatformAdminJwtAuthGuard)
export class PlatformAdminAuditController {
  constructor(private readonly audit: PlatformAuditService) {}

  @Get()
  list(@Query() query: QueryAuditLogDto) {
    return this.audit.list(query);
  }
}
