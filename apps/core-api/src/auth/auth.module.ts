import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TenantsModule } from "../tenants/tenants.module";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { TenantMatchGuard } from "./tenant-match.guard";

const jwtModule = JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.get<string>("JWT_SECRET"),
    signOptions: { expiresIn: "7d" },
  }),
});

@Module({
  imports: [TenantsModule, UsersModule, jwtModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, TenantMatchGuard],
  // JwtModule re-exported, not just the guards: JwtAuthGuard's constructor
  // needs JwtService, and any module that imports AuthModule purely to use
  // that guard (e.g. ProductsModule) needs it resolvable in its own
  // injector context too — exporting only the guard classes isn't enough.
  exports: [JwtAuthGuard, TenantMatchGuard, jwtModule],
})
export class AuthModule {}
