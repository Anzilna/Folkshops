import { Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { NotificationsService } from "./notifications.service";

// Staff-only, same guard shape as CategoriesController — no RBAC
// restriction (matches the project-wide deferred RolesGuard).
@Controller("notifications")
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.notifications.list(tenant.id);
  }

  @Post(":id/read")
  async markRead(@Param("id") id: string, @CurrentTenant() tenant: TenantContext) {
    const row = await this.notifications.markRead(tenant.id, id);
    if (!row) throw new NotFoundException("Notification not found");
    return row;
  }

  @Post("read-all")
  async markAllRead(@CurrentTenant() tenant: TenantContext) {
    await this.notifications.markAllRead(tenant.id);
    return { ok: true };
  }
}
