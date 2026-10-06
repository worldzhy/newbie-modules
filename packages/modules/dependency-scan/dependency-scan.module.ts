import { Global, Module } from "@nestjs/common";
import { DependencyScanController } from "./dependency-scan.controller";
import { DependencyScanService } from "./dependency-scan.service";

@Global()
@Module({
  controllers: [DependencyScanController],
  providers: [DependencyScanService],
  exports: [DependencyScanService],
})
export class DependencyScanModule {}
