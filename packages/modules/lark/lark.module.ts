import { Global, Module } from "@nestjs/common";
import { LarkController } from "./lark.controller";
import { LarkService } from "./lark.service";
import { LarkWsService } from "./lark-ws.service";

@Global()
@Module({
  imports: [],
  controllers: [LarkController],
  providers: [LarkService, LarkWsService],
  exports: [LarkService],
})
export class LarkModule {}
