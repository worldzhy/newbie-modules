import { Global, Module } from "@nestjs/common";
import { EventEmitterModule as NestEventEmitterModule } from "@nestjs/event-emitter";
import { EventCatalogService } from "./event-catalog.service";
import { EventEmitterService } from "./event-emitter.service";
import { EventEmitterController } from "./event-emitter.controller";

@Global()
@Module({
  // This module is the unique owner of EventEmitterModule.forRoot(): importing
  // forRoot more than once in one application creates two EventEmitter2
  // instances, and listeners attached to one never see emissions on the other.
  // The re-export below makes EventEmitter2 globally injectable.
  imports: [NestEventEmitterModule.forRoot({ wildcard: true })],
  controllers: [EventEmitterController],
  providers: [EventCatalogService, EventEmitterService],
  exports: [NestEventEmitterModule, EventCatalogService],
})
export class EventEmitterModule {}
