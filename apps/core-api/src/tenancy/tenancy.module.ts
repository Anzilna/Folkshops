import { Module } from "@nestjs/common";
import { TenantsModule } from "../tenants/tenants.module";
import { TenantResolverMiddleware } from "./tenant-resolver.middleware";

@Module({
  imports: [TenantsModule],
  providers: [TenantResolverMiddleware],
  exports: [TenantResolverMiddleware],
})
export class TenancyModule {}
