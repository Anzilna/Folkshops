import { Module } from "@nestjs/common";
import { RealtimeBridgeService } from "./realtime-bridge.service";
import { RealtimeController } from "./realtime.controller";
import { RealtimeService } from "./realtime.service";

@Module({
  controllers: [RealtimeController],
  providers: [RealtimeBridgeService, RealtimeService],
})
export class RealtimeModule {}
