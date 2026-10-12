import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TokensModule } from "../auth/tokens.module";
import { TenantsModule } from "../tenants/tenants.module";
import { PlatformAdminActivityController } from "./activity/platform-admin-activity.controller";
import { PlatformAdminActivityService } from "./activity/platform-admin-activity.service";
import { PlatformAdminAuditController } from "./audit/platform-admin-audit.controller";
import { PlatformAuditService } from "./audit/platform-audit.service";
import { PlatformAdminPlansController } from "./plans/platform-admin-plans.controller";
import { PlatformAdminPlansService } from "./plans/platform-admin-plans.service";
import { PlatformAdminTeamController } from "./team/platform-admin-team.controller";
import { PlatformAdminTeamService } from "./team/platform-admin-team.service";
import { PlatformAdminTenantsService } from "./tenants/platform-admin-tenants.service";
import { PlatformAdminDashboardController } from "./dashboard/platform-admin-dashboard.controller";
import { PlatformAdminDashboardService } from "./dashboard/platform-admin-dashboard.service";
import { PlatformAdminAuthController } from "./platform-admin-auth.controller";
import { PlatformAdminAuthService } from "./platform-admin-auth.service";
import { PlatformAdminJwtAuthGuard } from "./guards/platform-admin-jwt-auth.guard";
import { PlatformAdminsService } from "./platform-admins.service";
import { PlatformAdminTenantsController } from "./tenants/platform-admin-tenants.controller";

// A distinct secret from AuthModule's jwtModule — see
// PlatformAdminJwtAuthGuard for why that separation matters. This
// JwtModule instance is scoped to this module only, never exported, so
// nothing outside platform-admin can accidentally sign/verify with it.
const jwtModule = JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.get<string>("PLATFORM_ADMIN_JWT_SECRET"),
    signOptions: { expiresIn: "15m" },
  }),
});

@Module({
  imports: [jwtModule, TokensModule, TenantsModule],
  controllers: [
    PlatformAdminAuthController,
    PlatformAdminTenantsController,
    PlatformAdminDashboardController,
    PlatformAdminPlansController,
    PlatformAdminActivityController,
    PlatformAdminAuditController,
    PlatformAdminTeamController,
  ],
  providers: [
    PlatformAdminAuthService,
    PlatformAdminsService,
    PlatformAdminJwtAuthGuard,
    PlatformAdminDashboardService,
    PlatformAdminTenantsService,
    PlatformAdminPlansService,
    PlatformAdminActivityService,
    PlatformAdminTeamService,
    PlatformAuditService,
  ],
})
export class PlatformAdminModule {}
