import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { S3Service } from "./s3.service";
import { UploadsController } from "./uploads.controller";

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [S3Service],
})
export class UploadsModule {}
