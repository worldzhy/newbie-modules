import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { LarkController } from "./lark.controller";
import { LarkService } from "./lark.service";
import { LarkWsService } from "./lark-ws.service";

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [LarkController],
  providers: [LarkService, LarkWsService],
  exports: [LarkService],
})
export class LarkModule {}
