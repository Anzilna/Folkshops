import { Module } from "@nestjs/common";
import { SearchModule } from "../search/search.module";
import { BusinessEventConsumerService } from "./business-event-consumer.service";
import { CdcConsumerService } from "./cdc-consumer.service";

@Module({
  imports: [SearchModule],
  providers: [CdcConsumerService, BusinessEventConsumerService],
})
export class KafkaConsumersModule {}
