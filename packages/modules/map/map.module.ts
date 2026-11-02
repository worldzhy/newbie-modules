import { Global, Module } from "@nestjs/common";
import { PlaceController } from "./place.controller";

@Global()
@Module({
  controllers: [PlaceController],
})
export class MapModule {}
