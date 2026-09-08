import { Module } from "@nestjs/common";
import { TokenService } from "./token.service";

/**
 * TokenService is intentionally its own module, not just a provider inside
 * AuthModule — it's shared refresh-token infrastructure for all three auth
 * surfaces (staff, platform_admin, customer), not staff-specific. Modules
 * for the other surfaces import this directly instead of importing all of
 * AuthModule just to reach it.
 */
@Module({
  providers: [TokenService],
  exports: [TokenService],
})
export class TokensModule {}
