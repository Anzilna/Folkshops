import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { KafkaLagController } from "./kafka-lag.controller";

@Module({
  controllers: [HealthController, KafkaLagController],
})
export class HealthModule {}
