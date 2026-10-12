import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from "@nestjs/common";
import { PlatformAdminJwtAuthGuard } from "../guards/platform-admin-jwt-auth.guard";
import { PlatformAdminActivityService } from "./platform-admin-activity.service";

const MAX_FEED = 50;

@Controller("platform-admin/activity")
@UseGuards(PlatformAdminJwtAuthGuard)
export class PlatformAdminActivityController {
  constructor(private readonly activity: PlatformAdminActivityService) {}

  @Get()
  feed(@Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.activity.feed(Math.min(Math.max(limit, 1), MAX_FEED));
  }
}
