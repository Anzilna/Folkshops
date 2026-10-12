import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { TenantsModule } from "../tenants/tenants.module";
import { StoreAvailableGuard } from "./store-available.guard";
import { TenantResolverMiddleware } from "./tenant-resolver.middleware";

@Module({
  imports: [TenantsModule],
  providers: [TenantResolverMiddleware, { provide: APP_GUARD, useClass: StoreAvailableGuard }],
  exports: [TenantResolverMiddleware],
})
export class TenancyModule {}
