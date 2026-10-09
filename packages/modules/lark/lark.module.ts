import { Global, Module } from "@nestjs/common";
import { LarkController } from "./lark.controller";
import { LarkService } from "./lark.service";
import { LarkWebSocketService } from "./lark-websocket.service";

@Global()
@Module({
  imports: [],
  controllers: [LarkController],
  providers: [LarkService, LarkWebSocketService],
  exports: [LarkService],
})
export class LarkModule {}
