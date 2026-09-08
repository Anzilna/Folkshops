import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TokensModule } from "../auth/tokens.module";
import { ConsoleOtpProvider } from "./console-otp.provider";
import { CustomerAuthController } from "./customer-auth.controller";
import { CustomerAuthService } from "./customer-auth.service";
import { CustomerJwtAuthGuard } from "./guards/customer-jwt-auth.guard";
import { CustomerTenantMatchGuard } from "./guards/customer-tenant-match.guard";
import { OTP_PROVIDER } from "./otp-provider";

// A distinct secret from both staff and platform_admin — see
// CustomerJwtAuthGuard for why this boundary matters most of the three.
const jwtModule = JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.get<string>("CUSTOMER_JWT_SECRET"),
    signOptions: { expiresIn: "15m" },
  }),
});

@Module({
  // ThrottlerModule itself is registered once, globally, in AppModule —
  // not here. This module only uses the guard on one route.
  imports: [jwtModule, TokensModule],
  controllers: [CustomerAuthController],
  providers: [
    CustomerAuthService,
    CustomerJwtAuthGuard,
    CustomerTenantMatchGuard,
    // Real SMS delivery needs a vendor decision (MSG91/Twilio/AWS SNS) not
    // made yet — see ConsoleOtpProvider. Swap this useClass once one is.
    { provide: OTP_PROVIDER, useClass: ConsoleOtpProvider },
  ],
})
export class StorefrontModule {}
