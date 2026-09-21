import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { CartModule } from "./cart/cart.module";
import { CategoriesModule } from "./categories/categories.module";
import { CustomersModule } from "./customers/customers.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory/inventory.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OrdersModule } from "./orders/orders.module";
import { StorefrontOrdersModule } from "./orders/storefront-orders.module";
import { PaymentAccountsModule } from "./payments/payment-accounts.module";
import { PaymentsWebhookModule } from "./payments/payments-webhook.module";
import { StorefrontPaymentsModule } from "./payments/storefront-payments.module";
import { PlatformAdminModule } from "./platform-admin/platform-admin.module";
import { ProductsModule } from "./products/products.module";
import { RedisThrottlerStorage } from "./redis/redis-throttler.storage";
import { RedisModule } from "./redis/redis.module";
import { StorefrontModule } from "./storefront/storefront.module";
import { TenancyModule } from "./tenancy/tenancy.module";
import { TenantResolverMiddleware } from "./tenancy/tenant-resolver.middleware";
import { TenantsModule } from "./tenants/tenants.module";
import { UploadsModule } from "./uploads/uploads.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Registered once, globally — CqrsModule is @Global(), so CommandBus/
    // QueryBus are injectable everywhere without re-importing. Individual
    // @CommandHandler/@QueryHandler classes still need to be added to
    // their own feature module's `providers` array to be discovered at
    // boot — this import alone doesn't register any handler. Only
    // products/payments/orders have handlers today (a deliberate, partial
    // migration — see docs/decisions/0010-partial-cqrs-migration.md).
    CqrsModule.forRoot(),
    RedisModule,
    DatabaseModule,
    // Registered once, globally — cross-cutting infra, not owned by
    // whichever feature module happens to be the first consumer. Any
    // route in any module opts in with @UseGuards(ThrottlerGuard) +
    // @Throttle(...); this just decides how counts are stored.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: "default", ttl: 60_000, limit: 20 }],
        storage,
      }),
    }),
    HealthModule,
    TenancyModule,
    TenantsModule,
    UsersModule,
    AuthModule,
    ProductsModule,
    CategoriesModule,
    InventoryModule,
    CustomersModule,
    PlatformAdminModule,
    StorefrontModule,
    CartModule,
    OrdersModule,
    StorefrontOrdersModule,
    StorefrontPaymentsModule,
    PaymentsWebhookModule,
    PaymentAccountsModule,
    UploadsModule,
    NotificationsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolverMiddleware).forRoutes("*");
  }
}
