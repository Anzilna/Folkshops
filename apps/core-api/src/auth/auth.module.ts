import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TenantsModule } from "../tenants/tenants.module";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { TenantMatchGuard } from "./guards/tenant-match.guard";
import { TokensModule } from "./tokens.module";

// Short-lived on purpose now that refresh tokens exist (TokenService) — a
// stolen access token is only useful for 15 minutes, not 7 days. Sessions
// stay alive via POST /auth/refresh, which re-derives fresh claims rather
// than trusting anything cached in the old token.
const jwtModule = JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.get<string>("JWT_SECRET"),
    signOptions: { expiresIn: "15m" },
  }),
});

@Module({
  imports: [TenantsModule, UsersModule, jwtModule, TokensModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, TenantMatchGuard],
  // JwtModule re-exported, not just the guards: JwtAuthGuard's constructor
  // needs JwtService, and any module that imports AuthModule purely to use
  // that guard (e.g. ProductsModule) needs it resolvable in its own
  // injector context too — exporting only the guard classes isn't enough.
  exports: [JwtAuthGuard, TenantMatchGuard, jwtModule],
})
export class AuthModule {}
