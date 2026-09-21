import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { AnalyticsApiModule } from "./analytics-api/analytics-api.module";
import { HealthModule } from "./health/health.module";
import { KafkaConsumersModule } from "./kafka-consumers/kafka-consumers.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { SearchModule } from "./search/search.module";

@Module({
  // CqrsModule.forRoot() registered once, globally (see core-api's
  // app.module.ts for the same comment) — only AnalyticsApiModule has
  // handlers today (docs/decisions/0010-partial-cqrs-migration.md).
  imports: [ConfigModule.forRoot({ isGlobal: true }), CqrsModule.forRoot(), SearchModule, KafkaConsumersModule, AnalyticsApiModule, RealtimeModule, HealthModule],
})
export class AppModule {}
