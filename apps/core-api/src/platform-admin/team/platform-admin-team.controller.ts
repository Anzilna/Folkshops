import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ThrottlerGuard, Throttle } from "@nestjs/throttler";
import { CurrentPlatformAdmin } from "../decorators/current-platform-admin.decorator";
import { PlatformAdminJwtAuthGuard } from "../guards/platform-admin-jwt-auth.guard";
import type { PlatformAdminJwtPayload } from "../platform-admin-auth.service";
import { CreatePlatformAdminDto, QueryPlatformAdminsDto } from "./platform-admin-team.dto";
import { PlatformAdminTeamService } from "./platform-admin-team.service";

@Controller("platform-admin/admins")
@UseGuards(PlatformAdminJwtAuthGuard)
export class PlatformAdminTeamController {
  constructor(private readonly team: PlatformAdminTeamService) {}

  @Get()
  list(@Query() query: QueryPlatformAdminsDto) {
    return this.team.list(query);
  }

  // Throttled: creating an account is the most sensitive thing here and
  // nothing legitimate does it in bulk.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreatePlatformAdminDto, @CurrentPlatformAdmin() actor: PlatformAdminJwtPayload) {
    return this.team.create(actor, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(@Param("id", ParseUUIDPipe) id: string, @CurrentPlatformAdmin() actor: PlatformAdminJwtPayload) {
    await this.team.remove(actor, id);
    return { ok: true };
  }
}
